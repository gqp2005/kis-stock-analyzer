import type { WangWeeklyDetectorBundle, WangWeeklyDetectorInput } from "../../types";
import { getWeeklyDetectorMetrics } from "./common";
import { accumulationWindowDetector } from "./accumulationWindowDetector";
import { baseDirectionAnchorDetector } from "./baseDirectionAnchorDetector";
import { baseRepeatDetector } from "./baseRepeatDetector";
import { baseVolumeDetector } from "./baseVolumeDetector";
import { elasticVolumeDetector } from "./elasticVolumeDetector";
import { lifeVolumeDetector } from "./lifeVolumeDetector";
import { minVolumePointDetector } from "./minVolumePointDetector";
import { minVolumeRegionDetector } from "./minVolumeRegionDetector";
import { pitDiggingDetector } from "./pitDiggingDetector";
import { risingVolumeDetector } from "./risingVolumeDetector";
import { supplyFlushTestDetector } from "./supplyFlushTestDetector";

export const detectWeeklyWangStructure = (input: WangWeeklyDetectorInput): WangWeeklyDetectorBundle => {
  const metrics = getWeeklyDetectorMetrics(input);
  const lifeVolume = lifeVolumeDetector(input);
  const baseVolume = baseVolumeDetector(input, { metrics, lifeVolume });
  const baseRepeat = baseRepeatDetector(baseVolume);
  const baseDirectionAnchor = baseDirectionAnchorDetector(input, baseVolume);
  const risingVolume = risingVolumeDetector(input, metrics, baseVolume);
  const elasticVolume = elasticVolumeDetector(input, metrics, baseVolume, risingVolume);
  const minVolumeRegion = minVolumeRegionDetector(input, metrics, baseVolume, risingVolume, elasticVolume);
  const minVolumePoint = minVolumePointDetector(input, minVolumeRegion);
  const accumulationWindow = accumulationWindowDetector(input, minVolumeRegion);
  const pitDigging = pitDiggingDetector(input, metrics, minVolumeRegion);
  const supplyFlushTest = supplyFlushTestDetector(input, pitDigging);

  return {
    metrics,
    lifeVolume,
    baseVolume,
    baseRepeat,
    baseDirectionAnchor,
    risingVolume,
    elasticVolume,
    minVolumeRegion,
    minVolumePoint,
    accumulationWindow,
    pitDigging,
    supplyFlushTest,
  };
};
