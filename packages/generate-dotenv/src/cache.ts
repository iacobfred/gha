import { restoreCache, saveCache } from "@actions/cache";
import * as core from "@actions/core";
import { Inputs } from "./inputs";

export async function restoreDotEnvFromCache({
  cacheKey,
  outputPath,
}: Pick<Inputs, "cacheKey" | "outputPath">): ReturnType<typeof restoreCache> {
  const pathsToRestore = [outputPath];

  // TODO: Add note in README that we use this environment variable.
  // Caches are downloaded in multiple segments, and sometimes a segment download gets stuck,
  // causing the job to be stuck forever and eventually fail. The default timeout is 60 minutes,
  // which is excessive for our use case, so here we set the timeout to 15 minutes by default.
  process.env.SEGMENT_DOWNLOAD_TIMEOUT_MINS =
    process.env.SEGMENT_DOWNLOAD_TIMEOUT_MINS ?? "15";

  core.info(
    `Attempting to restore dotenv file from cache using the following key: ${cacheKey}`
  );

  return restoreCache(pathsToRestore, cacheKey);
}

export async function saveDotEnvToCache({
  cacheKey,
  outputPath,
}: Pick<Inputs, "cacheKey" | "outputPath">): ReturnType<typeof saveCache> {
  core.info(
    `Attempting to save dotenv file to cache using the following key: ${cacheKey}`
  );
  return saveCache([outputPath], cacheKey);
}
