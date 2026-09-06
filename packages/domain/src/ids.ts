import { customAlphabet } from "nanoid";

/**
 * Client-generated IDs (nanoid, URL-safe alphabet) so entities can be created
 * offline and synced later without remapping.
 */
const nano = customAlphabet("0123456789abcdefghijklmnopqrstuvwxyz", 12);

export type Id = string;

export const newId = (): Id => nano();

export const newTripId = (): Id => `trip_${nano()}`;
export const newPlaceId = (): Id => `plc_${nano()}`;
export const newDayId = (): Id => `day_${nano()}`;
