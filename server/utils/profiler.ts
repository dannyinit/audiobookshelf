import { performance, createHistogram } from 'perf_hooks'
import util = require('util')
import Logger = require('../Logger')

type ProfileHistogram = import('perf_hooks').RecordableHistogram & { values: number[] }

const histograms = new Map<string, ProfileHistogram>()

function profile<A extends any[], R>(asyncFunc: (...args: A) => Promise<R>, isFindQuery = true, funcName = asyncFunc.name) {
  if (!histograms.has(funcName)) {
    const histogram = createHistogram() as ProfileHistogram
    histogram.values = []
    histograms.set(funcName, histogram)
  }
  const histogram = histograms.get(funcName)!

  return async (...args: A) => {
    if (isFindQuery) {
      const findOptions = args[0]
      Logger.info(`[${funcName}] findOptions:`, util.inspect(findOptions, { depth: null }))
      findOptions.logging = (query: string, time: number) => Logger.info(`[${funcName}] ${query} Elapsed time: ${time}ms`)
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

export { profile }
