import type { Response, NextFunction } from 'express'
import Logger = require('../Logger')
import SocketAuthority = require('../SocketAuthority')
import Database = require('../Database')

import RssFeedManager = require('../managers/RssFeedManager')

import libraryItemsBookFilters = require('../utils/queries/libraryItemsBookFilters')
import type { RequestWithUser } from './types'
import type { FilteredLibraryItem } from '../utils/queries/types'

type Series = import('../models/Series')

interface RequestEntityObject {
  series: Series
  libraryItemsInSeries: FilteredLibraryItem[]
}

type SeriesControllerRequest = RequestWithUser & RequestEntityObject

class SeriesController {
  constructor() {}

  /**
   * @deprecated
   * /api/series/:id
   *
   * TODO: Update mobile app to use /api/libraries/:id/series/:seriesId API route instead
   * Series are not library specific so we need to know what the library id is
   */
  async findOne(req: SeriesControllerRequest, res: Response) {
    // cast(d): query value
    const include = ((req.query.include as string | undefined) || '')
      .split(',')
      .map((v) => v.trim())
      .filter((v) => !!v)

    const seriesJson: ReturnType<Series['toOldJSON']> & {
      progress?: { libraryItemIds: string[]; libraryItemIdsFinished: string[]; isFinished: boolean }
      rssFeed?: unknown
    } = req.series.toOldJSON()

    // Add progress map with isFinished flag
    if (include.includes('progress')) {
      const libraryItemsInSeries = req.libraryItemsInSeries
      const libraryItemsFinished = libraryItemsInSeries.filter((li) => {
        return req.user.getMediaProgress(li.media.id)?.isFinished
      })
      seriesJson.progress = {
        libraryItemIds: libraryItemsInSeries.map((li) => li.id),
        libraryItemIdsFinished: libraryItemsFinished.map((li) => li.id),
        isFinished: libraryItemsFinished.length === libraryItemsInSeries.length
      }
    }

    if (include.includes('rssfeed')) {
      const feedObj = await RssFeedManager.findFeedForEntityId(seriesJson.id)
      seriesJson.rssFeed = feedObj?.toOldJSONMinified() || null
    }

    res.json(seriesJson)
  }

  /**
   * TODO: Currently unused in the client, should check for duplicate name
   */
  async update(req: SeriesControllerRequest, res: Response) {
    const keysToUpdate: ('name' | 'description')[] = ['name', 'description']
    const payload: { name?: string; description?: string } = {}
    for (const key of keysToUpdate) {
      if (req.body[key] !== undefined && typeof req.body[key] === 'string') {
        payload[key] = req.body[key]
      }
    }
    if (!Object.keys(payload).length) {
      return res.status(400).send('No valid fields to update')
    }
    req.series.set(payload)
    if (req.series.changed()) {
      await req.series.save()
      SocketAuthority.emitter('series_updated', req.series.toOldJSON())
    }
    res.json(req.series.toOldJSON())
  }

  async middleware(req: RequestWithUser & Partial<RequestEntityObject>, res: Response, next: NextFunction) {
    const series = await Database.seriesModel.findByPk(req.params.id)
    if (!series) return res.sendStatus(404)

    /**
     * Filter out any library items not accessible to user
     */
    const libraryItems = await libraryItemsBookFilters.getLibraryItemsForSeries(series, req.user)
    if (!libraryItems.length) {
      Logger.warn(`[SeriesController] User "${req.user.username}" attempted to access series "${series.id}" with no accessible books`)
      return res.sendStatus(404)
    }

    if (req.method == 'DELETE' && !req.user.canDelete) {
      Logger.warn(`[SeriesController] User "${req.user.username}" attempted to delete without permission`)
      return res.sendStatus(403)
    } else if ((req.method == 'PATCH' || req.method == 'POST') && !req.user.canUpdate) {
      Logger.warn(`[SeriesController] User "${req.user.username}" attempted to update without permission`)
      return res.sendStatus(403)
    }

    req.series = series
    req.libraryItemsInSeries = libraryItems
    next()
  }
}
export = new SeriesController()
