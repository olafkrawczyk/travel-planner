export { mulberry32, pick, randInt, shuffle, type Rng } from "./rng";
export {
  TravelMatrix,
  buildProblem,
  heuristicEntry,
  reasonFor,
  dayNodeIds,
  apiMatrixCoords,
  staySegments,
  type Problem,
  type MatrixEntry,
} from "./matrix";
export {
  recommendHotelAreas,
  weightForPlace,
  weightedGeometricMedian,
  coarseClusterPlaces,
  DEFAULT_COARSE_THRESHOLD_KM,
  DEFAULT_COMMUTE_STRAIN_MIN,
  DEFAULT_MAX_TRAVEL_REGRESSION_MIN,
  findStrainedPlaces,
  discoverReliefClusters,
  estimateClusterWorkloadMin,
  buildSpeculativeStays,
  calculateWorkloadNights,
  orderBasesByRoute,
  findExternalClusters,
  createSpeculativeTrip,
  MIN_TRANSIT_SAVINGS_MIN,
  MIN_BASE_SEPARATION_MIN,
  MIN_RESCUED_PLACES,
  evaluateBaseSuggestions,
  type HotelAreaSegment,
  type HotelAreaCandidate,
  type CoarseCluster,
  type SpeculativeStay,
  type SuggestedBase,
  type EvaluateBasesOptions,
} from "./hotelArea";
export { giantTour } from "./giantTour";
export { kMeans, type KMeansOptions } from "./kmeans";
export { split, type SplitResult } from "./split";
export { sequenceDay, computeTimes, type SequenceResult, type DayWindow } from "./sequence";
export {
  alns,
  evaluate,
  cloneState,
  poolReason,
  entryNode,
  exitNode,
  type State,
  type AlnsOptions,
  type AlnsResult,
  type Evaluation,
} from "./alns";
export { solve, resolve, finalize, repairPass, type SolveOptions, type ResolveOptions, type Edit } from "./solve";
export { explainUnscheduled, classifyUnscheduled } from "./explain";
export { validateTripInput, SolverInputError } from "./validate";
