import prisma from '../lib/prisma.js';

/**
 * Helper to generate round specifications for a given team count.
 * @param {number} teamCount - Supported team count (4, 8, 16, 32, 64)
 * @returns {Array<{ matchCount: number, roundName: string }>}
 */
const getRoundSpecs = (teamCount) => {
  const roundSpecs = [];
  let currentMatches = teamCount / 2;

  const getRoundName = (matchCount) => {
    switch (matchCount) {
      case 32: return 'Round of 64';
      case 16: return 'Round of 32';
      case 8: return 'Round of 16';
      case 4: return 'Quarter Final';
      case 2: return 'Semi Final';
      case 1: return 'Final';
      default: return `Round of ${matchCount * 2}`;
    }
  };

  while (currentMatches >= 1) {
    roundSpecs.push({
      matchCount: currentMatches,
      roundName: getRoundName(currentMatches)
    });
    currentMatches = currentMatches / 2;
  }

  return roundSpecs;
};

/**
 * POST /api/tournaments/:tournamentId/knockout/generate
 * Generates a complete knockout bracket for a tournament.
 */
export const generateKnockoutBracket = async (req, res) => {
  try {
    const { tournamentId } = req.params;

    // 1. Verify tournament exists
    const tournament = await prisma.tournament.findUnique({
      where: { id: tournamentId },
      select: { id: true, name: true, startDate: true }
    });

    if (!tournament) {
      return res.status(404).json({ error: 'Tournament not found.' });
    }

    // 2. Check if tournament already has knockout matches
    const existingKnockoutMatch = await prisma.match.findFirst({
      where: {
        tournamentId,
        bracketPosition: { not: null }
      }
    });

    if (existingKnockoutMatch) {
      return res.status(400).json({
        error: 'Knockout bracket already exists for this tournament.'
      });
    }

    // 3. Fetch registered teams
    const teams = await prisma.team.findMany({
      where: { tournamentId },
      orderBy: { createdAt: 'asc' },
      select: { id: true, name: true, shortName: true, logoUrl: true }
    });

    const teamCount = teams.length;
    const supportedCounts = [4, 8, 16, 32, 64];

    // 4. Validate team count
    if (!supportedCounts.includes(teamCount)) {
      return res.status(400).json({
        error: `Knockout bracket generation requires 4, 8, 16, 32, or 64 teams. Current team count is ${teamCount}.`
      });
    }

    // 5. Get round specifications
    const roundSpecs = getRoundSpecs(teamCount);

    const baseDate = tournament.startDate && !isNaN(new Date(tournament.startDate).getTime())
      ? new Date(tournament.startDate)
      : new Date();

    // 6. Execute atomic bracket creation inside a Prisma transaction
    const createdMatches = await prisma.$transaction(async (tx) => {
      const allMatches = [];
      let previousRoundMatches = [];

      for (let rIndex = 0; rIndex < roundSpecs.length; rIndex++) {
        const spec = roundSpecs[rIndex];
        const isFirstRound = (rIndex === 0);
        const currentRoundMatches = [];

        // Increment base date by 1 day per round
        const roundDate = new Date(baseDate.getTime() + rIndex * 24 * 60 * 60 * 1000);

        for (let mIndex = 0; mIndex < spec.matchCount; mIndex++) {
          const bracketPosition = mIndex + 1;
          const matchDate = new Date(roundDate.getTime() + mIndex * 2 * 60 * 60 * 1000);

          let homeTeamId = null;
          let awayTeamId = null;
          let homeSourceMatchId = null;
          let awaySourceMatchId = null;

          if (isFirstRound) {
            homeTeamId = teams[2 * mIndex]?.id || null;
            awayTeamId = teams[2 * mIndex + 1]?.id || null;
          } else {
            homeSourceMatchId = previousRoundMatches[2 * mIndex]?.id || null;
            awaySourceMatchId = previousRoundMatches[2 * mIndex + 1]?.id || null;
          }

          const match = await tx.match.create({
            data: {
              tournamentId,
              roundName: spec.roundName,
              bracketPosition,
              matchDate,
              homeTeamId,
              awayTeamId,
              homeSourceMatchId,
              awaySourceMatchId,
              status: 'scheduled'
            },
            include: {
              homeTeam: {
                select: { id: true, name: true, shortName: true, logoUrl: true }
              },
              awayTeam: {
                select: { id: true, name: true, shortName: true, logoUrl: true }
              }
            }
          });

          currentRoundMatches.push(match);
          allMatches.push(match);
        }

        previousRoundMatches = currentRoundMatches;
      }

      return allMatches;
    });

    // 7. Group generated matches by round
    const bracket = {};
    for (const spec of roundSpecs) {
      bracket[spec.roundName] = createdMatches.filter(m => m.roundName === spec.roundName);
    }

    return res.status(201).json({
      message: 'Knockout bracket generated successfully.',
      tournament: {
        id: tournament.id,
        name: tournament.name
      },
      totalMatches: createdMatches.length,
      bracket
    });

  } catch (err) {
    console.error('Error generating knockout bracket:', err);
    return res.status(500).json({ error: 'Internal server error.' });
  }
};

/**
 * PUT /api/tournaments/:tournamentId/knockout/matches/:matchId
 * Updates details of a knockout match (teams, matchDate, venue, refereeName).
 */
export const updateKnockoutMatch = async (req, res) => {
  try {
    const { tournamentId, matchId } = req.params;
    const userId = req.user.id;

    // 1. Verify tournament exists & user authorization
    const tournament = await prisma.tournament.findUnique({
      where: { id: tournamentId },
      select: { id: true, name: true, organizerId: true }
    });

    if (!tournament) {
      return res.status(404).json({ error: 'Tournament not found.' });
    }

    const user = await prisma.profile.findUnique({
      where: { id: userId },
      select: { id: true, role: true }
    });

    if (!user || (tournament.organizerId !== userId && user.role !== 'admin')) {
      return res.status(403).json({ error: 'Only the tournament organizer or an admin can update knockout matches.' });
    }

    // 2. Verify match exists and belongs to the tournament
    const existingMatch = await prisma.match.findUnique({
      where: { id: matchId }
    });

    if (!existingMatch || existingMatch.tournamentId !== tournamentId) {
      return res.status(404).json({ error: 'Match not found in this tournament.' });
    }

    const { homeTeamId, awayTeamId, matchDate, venue, refereeName } = req.body;

    // 3. Source match dependency validation:
    // Slots fed by source matches cannot be manually assigned
    if (existingMatch.homeSourceMatchId && homeTeamId !== undefined && homeTeamId !== null && homeTeamId !== existingMatch.homeTeamId) {
      return res.status(400).json({ error: 'Cannot manually assign home team to a match slot fed by a previous match winner.' });
    }

    if (existingMatch.awaySourceMatchId && awayTeamId !== undefined && awayTeamId !== null && awayTeamId !== existingMatch.awayTeamId) {
      return res.status(400).json({ error: 'Cannot manually assign away team to a match slot fed by a previous match winner.' });
    }

    const targetHomeTeamId = homeTeamId !== undefined ? homeTeamId : existingMatch.homeTeamId;
    const targetAwayTeamId = awayTeamId !== undefined ? awayTeamId : existingMatch.awayTeamId;

    // 4. Validate same team restriction
    if (targetHomeTeamId && targetAwayTeamId && targetHomeTeamId === targetAwayTeamId) {
      return res.status(400).json({ error: 'Home team and away team cannot be the same team.' });
    }

    // 5. Validate homeTeam belongs to tournament
    if (homeTeamId) {
      const homeTeam = await prisma.team.findUnique({
        where: { id: homeTeamId },
        select: { id: true, tournamentId: true }
      });
      if (!homeTeam || homeTeam.tournamentId !== tournamentId) {
        return res.status(400).json({ error: 'Home team does not belong to this tournament.' });
      }
    }

    // 6. Validate awayTeam belongs to tournament
    if (awayTeamId) {
      const awayTeam = await prisma.team.findUnique({
        where: { id: awayTeamId },
        select: { id: true, tournamentId: true }
      });
      if (!awayTeam || awayTeam.tournamentId !== tournamentId) {
        return res.status(400).json({ error: 'Away team does not belong to this tournament.' });
      }
    }

    // Build update object with allowed fields ONLY
    const updateData = {};
    if (homeTeamId !== undefined) updateData.homeTeamId = homeTeamId;
    if (awayTeamId !== undefined) updateData.awayTeamId = awayTeamId;
    if (matchDate !== undefined) updateData.matchDate = new Date(matchDate);
    if (venue !== undefined) updateData.venue = venue;
    if (refereeName !== undefined) updateData.refereeName = refereeName;

    // Perform update
    const updatedMatch = await prisma.match.update({
      where: { id: matchId },
      data: updateData,
      include: {
        homeTeam: {
          select: {
            id: true,
            name: true,
            shortName: true,
            logoUrl: true
          }
        },
        awayTeam: {
          select: {
            id: true,
            name: true,
            shortName: true,
            logoUrl: true
          }
        },
        tournament: {
          select: {
            id: true,
            name: true
          }
        }
      }
    });

    return res.status(200).json({
      message: 'Knockout match updated successfully.',
      match: updatedMatch
    });

  } catch (err) {
    console.error('Error updating knockout match:', err);
    return res.status(500).json({ error: 'Internal server error.' });
  }
};

/**
 * PUT /api/tournaments/:tournamentId/knockout/matches/:matchId/result
 * Updates the result of a knockout match, including score, tie-break method, and winner.
 */
export const updateKnockoutMatchResult = async (req, res) => {
  try {
    const { tournamentId, matchId } = req.params;
    const userId = req.user.id;

    // 1. Verify tournament exists & user authorization
    const tournament = await prisma.tournament.findUnique({
      where: { id: tournamentId },
      select: { id: true, name: true, organizerId: true }
    });

    if (!tournament) {
      return res.status(404).json({ error: 'Tournament not found.' });
    }

    const user = await prisma.profile.findUnique({
      where: { id: userId },
      select: { id: true, role: true }
    });

    if (!user || (tournament.organizerId !== userId && user.role !== 'admin')) {
      return res.status(403).json({ error: 'Only the tournament organizer or an admin can update knockout match results.' });
    }

    // 2. Verify match exists, belongs to tournament, and is a knockout match
    const existingMatch = await prisma.match.findUnique({
      where: { id: matchId }
    });

    if (!existingMatch || existingMatch.tournamentId !== tournamentId || existingMatch.bracketPosition === null) {
      return res.status(404).json({ error: 'Match not found in this tournament or is not a knockout match.' });
    }

    // 3. Both teams must exist on the match
    if (!existingMatch.homeTeamId || !existingMatch.awayTeamId) {
      return res.status(400).json({ error: 'Both home and away teams must be set before submitting a match result.' });
    }

    const { homeScore, awayScore, tieBreakMethod, homePenaltyScore, awayPenaltyScore, winnerTeamId } = req.body;

    // 4. Validate scores are non-negative integers
    if (
      homeScore === undefined || homeScore === null || typeof homeScore !== 'number' || !Number.isInteger(homeScore) || homeScore < 0 ||
      awayScore === undefined || awayScore === null || typeof awayScore !== 'number' || !Number.isInteger(awayScore) || awayScore < 0
    ) {
      return res.status(400).json({ error: 'Home score and away score must be non-negative integers.' });
    }

    let finalWinnerTeamId = null;
    let finalTieBreakMethod = null;
    let finalHomePenaltyScore = null;
    let finalAwayPenaltyScore = null;

    // 5. Evaluate match outcome
    if (homeScore !== awayScore) {
      // Normal Win: Winner derived from match score, clear penalty fields
      finalWinnerTeamId = homeScore > awayScore ? existingMatch.homeTeamId : existingMatch.awayTeamId;
      finalTieBreakMethod = null;
      finalHomePenaltyScore = null;
      finalAwayPenaltyScore = null;
    } else {
      // Draw: Penalty or Toss required
      if (!tieBreakMethod || (tieBreakMethod !== 'penalty' && tieBreakMethod !== 'toss')) {
        return res.status(400).json({ error: 'A draw in a knockout match requires a valid tieBreakMethod ("penalty" or "toss").' });
      }

      if (tieBreakMethod === 'penalty') {
        if (
          homePenaltyScore === undefined || homePenaltyScore === null || typeof homePenaltyScore !== 'number' || !Number.isInteger(homePenaltyScore) || homePenaltyScore < 0 ||
          awayPenaltyScore === undefined || awayPenaltyScore === null || typeof awayPenaltyScore !== 'number' || !Number.isInteger(awayPenaltyScore) || awayPenaltyScore < 0
        ) {
          return res.status(400).json({ error: 'Penalty shootout scores are required and must be non-negative integers.' });
        }

        if (homePenaltyScore === awayPenaltyScore) {
          return res.status(400).json({ error: 'Penalty scores cannot be equal.' });
        }

        finalWinnerTeamId = homePenaltyScore > awayPenaltyScore ? existingMatch.homeTeamId : existingMatch.awayTeamId;
        finalTieBreakMethod = 'penalty';
        finalHomePenaltyScore = homePenaltyScore;
        finalAwayPenaltyScore = awayPenaltyScore;
      } else if (tieBreakMethod === 'toss') {
        if (!winnerTeamId || (winnerTeamId !== existingMatch.homeTeamId && winnerTeamId !== existingMatch.awayTeamId)) {
          return res.status(400).json({ error: 'Toss winnerTeamId is required and must be either the home team or away team.' });
        }

        finalWinnerTeamId = winnerTeamId;
        finalTieBreakMethod = 'toss';
        finalHomePenaltyScore = null;
        finalAwayPenaltyScore = null;
      }
    }

    // 6. Check if this match is the Final
    const isFinal = existingMatch.roundName === 'Final';

    // 7. Save result, advance winner, and update tournament status if Final atomically in a transaction
    const { updatedMatch, advancedTo } = await prisma.$transaction(async (tx) => {
      const match = await tx.match.update({
        where: { id: matchId },
        data: {
          homeScore,
          awayScore,
          homePenaltyScore: finalHomePenaltyScore,
          awayPenaltyScore: finalAwayPenaltyScore,
          tieBreakMethod: finalTieBreakMethod,
          winnerTeamId: finalWinnerTeamId,
          status: 'fulltime'
        },
        include: {
          homeTeam: {
            select: {
              id: true,
              name: true,
              shortName: true,
              logoUrl: true
            }
          },
          awayTeam: {
            select: {
              id: true,
              name: true,
              shortName: true,
              logoUrl: true
            }
          },
          winnerTeam: {
            select: {
              id: true,
              name: true,
              shortName: true,
              logoUrl: true
            }
          },
          tournament: {
            select: {
              id: true,
              name: true
            }
          }
        }
      });

      // If this is the Final, update the tournament status to completed
      if (isFinal) {
        await tx.tournament.update({
          where: { id: tournamentId },
          data: { status: 'completed' }
        });
      }

      // 8. Find next knockout match where homeSourceMatchId or awaySourceMatchId is current match ID
      const nextMatch = await tx.match.findFirst({
        where: {
          tournamentId,
          OR: [
            { homeSourceMatchId: matchId },
            { awaySourceMatchId: matchId }
          ]
        }
      });

      let nextMatchAdvanced = null;

      if (nextMatch) {
        const nextMatchUpdateData = {};
        if (nextMatch.homeSourceMatchId === matchId) {
          nextMatchUpdateData.homeTeamId = finalWinnerTeamId;
        }
        if (nextMatch.awaySourceMatchId === matchId) {
          nextMatchUpdateData.awayTeamId = finalWinnerTeamId;
        }

        if (Object.keys(nextMatchUpdateData).length > 0) {
          nextMatchAdvanced = await tx.match.update({
            where: { id: nextMatch.id },
            data: nextMatchUpdateData,
            include: {
              homeTeam: {
                select: {
                  id: true,
                  name: true,
                  shortName: true,
                  logoUrl: true
                }
              },
              awayTeam: {
                select: {
                  id: true,
                  name: true,
                  shortName: true,
                  logoUrl: true
                }
              }
            }
          });
        }
      }

      return { updatedMatch: match, advancedTo: nextMatchAdvanced };
    });

    const champion = isFinal && updatedMatch.winnerTeam ? {
      id: updatedMatch.winnerTeam.id,
      name: updatedMatch.winnerTeam.name,
      shortName: updatedMatch.winnerTeam.shortName,
      logoUrl: updatedMatch.winnerTeam.logoUrl
    } : null;

    return res.status(200).json({
      message: isFinal ? 'Final match completed and tournament completed successfully.' : 'Knockout match result updated successfully.',
      match: updatedMatch,
      winnerTeam: updatedMatch.winnerTeam,
      advancedTo: advancedTo || null,
      champion
    });

  } catch (err) {
    console.error('Error updating knockout match result:', err);
    return res.status(500).json({ error: 'Internal server error.' });
  }
};

