import { performance, createHistogram, RecordableHistogram } from 'perf_hooks'
import util = require('util')
import Logger = require('../Logger')

/**
 * Histogram that also keeps the raw recorded values
 */
type ProfilerHistogram = RecordableHistogram & { values: number[] }

/**
 * Sequelize find options fields set by the profiler
 */
interface ProfiledFindOptions {
  logging?: (query: string, time?: number) => void
  benchmark?: boolean
}

const histograms = new Map<string, ProfilerHistogram>()

function profile<A extends unknown[], R>(asyncFunc: (...args: A) => Promise<R>, isFindQuery = true, funcName = asyncFunc.name): (...args: A) => Promise<R> {
  if (!histograms.has(funcName)) {
    const histogram = createHistogram()
    // cast(d): values is added on the next line
    const profilerHistogram = histogram as ProfilerHistogram
    profilerHistogram.values = []
    histograms.set(funcName, profilerHistogram)
  }
  // cast(d): Map.get is typed as possibly undefined; the histogram is set above when missing
  const histogram = histograms.get(funcName) as ProfilerHistogram

  return async (...args: A) => {
    if (isFindQuery) {
      // cast(d): with isFindQuery (the default) the first argument of the profiled findAll or count is its options object
      const findOptions = args[0] as ProfiledFindOptions
      Logger.info(`[${funcName}] findOptions:`, util.inspect(findOptions, { depth: null }))
      findOptions.logging = (query, time) => Logger.info(`[${funcName}] ${query} Elapsed time: ${time}ms`)
      findOptions.benchmark = true
    }
    const start = performance.now()
    try {
      const result = await asyncFunc(...args)
      return result
    } catch (error) {
      Logger.error(`[${funcName}] failed`)
      throw error
    } finally {
      const end = performance.now()
      const duration = Math.round(end - start)
      histogram.record(duration)
      histogram.values.push(duration)
      Logger.info(`[${funcName}] duration: ${duration}ms`)
      Logger.info(`[${funcName}] histogram values:`, histogram.values)
      Logger.info(`[${funcName}] histogram:`, histogram)
    }
  }
}

export = { profile }
