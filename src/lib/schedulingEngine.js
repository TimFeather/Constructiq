/**
 * Legacy compatibility shim.
 * All imports of lib/schedulingEngine.js continue to work.
 * New code should import directly from lib/scheduling/scheduleEngine.js
 */
export { runScheduleEngine, computeCascade, wouldCreateCycle, isMilestone, isSummaryTask } from './scheduling/scheduleEngine.js';