import Sequelize = require('sequelize')
import type { Attributes, CreationOptional, HasManyGetAssociationsMixin, Includeable, InferAttributes, InferCreationAttributes, InitOptions, ModelAttributes, ModelStatic, NonAttribute } from 'sequelize'
import Logger = require('../Logger')
import SocketAuthority = require('../SocketAuthority')
import type Book = require('./Book')
import type LibraryItem = require('./LibraryItem')
import type PlaylistMediaItem = require('./PlaylistMediaItem')
import type Podcast = require('./Podcast')
import type PodcastEpisode = require('./PodcastEpisode')
import type { ModelsSequelize } from './types'
const { DataTypes, Model, Op } = Sequelize

class Playlist extends Model<InferAttributes<Playlist>, InferCreationAttributes<Playlist>> {
  declare id: CreationOptional<string>
  declare name: string
  declare description: string | null
  declare libraryId: string
  declare userId: string
  declare createdAt: CreationOptional<Date>
  declare updatedAt: CreationOptional<Date>

  declare sequelize: ModelsSequelize
  declare static readonly sequelize: ModelsSequelize

  // Expanded properties

  /** only set when expanded */
  declare playlistMediaItems: NonAttribute<PlaylistMediaItem[]>

  declare getPlaylistMediaItems: HasManyGetAssociationsMixin<PlaylistMediaItem>

  /**
   * Get old playlists for user and library
   */
  static async getOldPlaylistsForUserAndLibrary(userId: string, libraryId: string) {
    if (!userId && !libraryId) return []

    const whereQuery: { userId?: string; libraryId?: string } = {}
    if (userId) {
      whereQuery.userId = userId
    }
    if (libraryId) {
      whereQuery.libraryId = libraryId
    }
    const playlistsExpanded = await this.findAll({
      where: whereQuery,
      include: {
        model: this.sequelize.models.playlistMediaItem,
        include: [
          {
            model: this.sequelize.models.book,
            include: [
              {
                model: this.sequelize.models.libraryItem
              },
              {
                model: this.sequelize.models.author,
                through: {
                  attributes: []
                }
              },
              {
                model: this.sequelize.models.series,
                through: {
                  attributes: ['sequence']
                }
              }
            ]
          },
          {
            model: this.sequelize.models.podcastEpisode,
            include: {
              model: this.sequelize.models.podcast,
              include: this.sequelize.models.libraryItem
            }
          }
        ]
        // cast(b): sequelize accepts a single model or include object as a nested include, its types only allow an array
      } as unknown as Includeable,
      order: [['playlistMediaItems', 'order', 'ASC']]
    })

    // Sort by name asc
    playlistsExpanded.sort((a, b) => a.name.localeCompare(b.name))

    return playlistsExpanded.map((playlist) => playlist.toOldJSONExpanded())
  }

  /**
   * Get number of playlists for a user and library
   */
  static async getNumPlaylistsForUserAndLibrary(userId: string, libraryId: string) {
    return this.count({
      where: {
        userId,
        libraryId
      }
    })
  }

  /**
   * Get all playlists for mediaItemIds
   */
  static async getPlaylistsForMediaItemIds(mediaItemIds: string[]): Promise<Playlist[]> {
    if (!mediaItemIds?.length) return []

    const playlistMediaItemsExpanded = await this.sequelize.models.playlistMediaItem.findAll({
      where: {
        mediaItemId: {
          [Op.in]: mediaItemIds
        }
      },
      include: [
        {
          model: this.sequelize.models.playlist,
          include: {
            model: this.sequelize.models.playlistMediaItem,
            include: [
              {
                model: this.sequelize.models.book,
                include: this.sequelize.models.libraryItem
              },
              {
                model: this.sequelize.models.podcastEpisode,
                include: {
                  model: this.sequelize.models.podcast,
                  include: this.sequelize.models.libraryItem
                }
              }
            ]
          }
        }
        // cast(b): sequelize accepts a single model or include object as a nested include, its types only allow an array
      ] as unknown as Includeable[],
      order: [['playlist', 'playlistMediaItems', 'order', 'ASC']]
    })

    const playlists: Playlist[] = []
    for (const playlistMediaItem of playlistMediaItemsExpanded) {
      const playlist = playlistMediaItem.playlist
      if (playlists.some((p) => p.id === playlist.id)) continue

      playlist.playlistMediaItems = playlist.playlistMediaItems.map((pmi) => {
        // Same object as pmi.dataValues, typed with the included rows
        const dataValues: PlaylistMediaItem.DataValues = pmi.dataValues
        if (pmi.mediaItemType === 'book' && pmi.book !== undefined) {
          pmi.mediaItem = pmi.book
          dataValues.mediaItem = dataValues.book
        } else if (pmi.mediaItemType === 'podcastEpisode' && pmi.podcastEpisode !== undefined) {
          pmi.mediaItem = pmi.podcastEpisode
          dataValues.mediaItem = dataValues.podcastEpisode
        }
        delete pmi.book
        delete dataValues.book
        delete pmi.podcastEpisode
        delete dataValues.podcastEpisode
        return pmi
      })
      playlists.push(playlist)
    }
    return playlists
  }

  /**
   * Removes media items and re-orders playlists
   */
  static async removeMediaItemsFromPlaylists(mediaItemIds: string[]) {
    if (!mediaItemIds?.length) return

    const playlistsWithItem = await this.getPlaylistsForMediaItemIds(mediaItemIds)

    if (!playlistsWithItem.length) return

    for (const playlist of playlistsWithItem) {
      let numMediaItems = playlist.playlistMediaItems.length

      let order = 1
      // Remove items in playlist and re-order
      for (const playlistMediaItem of playlist.playlistMediaItems) {
        if (mediaItemIds.includes(playlistMediaItem.mediaItemId)) {
          await playlistMediaItem.destroy()
          numMediaItems--
        } else {
          if (playlistMediaItem.order !== order) {
            playlistMediaItem.update({
              order
            })
          }
          order++
        }
      }

      // If playlist is now empty then remove it
      const jsonExpanded = await playlist.getOldJsonExpanded()
      if (!numMediaItems) {
        Logger.info(`[ApiRouter] Playlist "${playlist.name}" has no more items - removing it`)
        await playlist.destroy()
        SocketAuthority.clientEmitter(playlist.userId, 'playlist_removed', jsonExpanded)
      } else {
        SocketAuthority.clientEmitter(playlist.userId, 'playlist_updated', jsonExpanded)
      }
    }
  }

  /**
   * Initialize model
   */
  static init(sequelize: ModelsSequelize): void
  // Model.init signature, only declared so the class stays assignable to Model (Database calls init(sequelize))
  static init<MS extends ModelStatic<Sequelize.Model>, M extends InstanceType<MS>>(this: MS, attributes: ModelAttributes<M, Attributes<M>> | ModelsSequelize, options?: InitOptions<M>): MS
  static init(sequelize: ModelsSequelize) {
    super.init(
      {
        id: {
          type: DataTypes.UUID,
          defaultValue: DataTypes.UUIDV4,
          primaryKey: true
        },
        name: DataTypes.STRING,
        description: DataTypes.TEXT
      },
      {
        sequelize,
        modelName: 'playlist'
      }
    )

    const { library, user } = sequelize.models
    library.hasMany(Playlist)
    Playlist.belongsTo(library)

    user.hasMany(Playlist, {
      onDelete: 'CASCADE'
    })
    Playlist.belongsTo(user)

    Playlist.addHook('afterFind', (findResult: Playlist[] | Playlist | null) => {
      if (!findResult) return

      if (!Array.isArray(findResult)) findResult = [findResult]

      for (const instance of findResult) {
        if (instance.playlistMediaItems?.length) {
          instance.playlistMediaItems = instance.playlistMediaItems.map((pmi) => {
            // Same object as pmi.dataValues, typed with the included rows
            const dataValues: PlaylistMediaItem.DataValues = pmi.dataValues
            if (pmi.mediaItemType === 'book' && pmi.book !== undefined) {
              pmi.mediaItem = pmi.book
              dataValues.mediaItem = dataValues.book
            } else if (pmi.mediaItemType === 'podcastEpisode' && pmi.podcastEpisode !== undefined) {
              pmi.mediaItem = pmi.podcastEpisode
              dataValues.mediaItem = dataValues.podcastEpisode
            }
            // To prevent mistakes:
            delete pmi.book
            delete dataValues.book
            delete pmi.podcastEpisode
            delete dataValues.podcastEpisode
            return pmi
          })
        }
      }
    })
  }

  /**
   * Get all media items in playlist expanded with library item
   */
  getMediaItemsExpandedWithLibraryItem(): Promise<PlaylistMediaItem[]> {
    return this.getPlaylistMediaItems({
      include: [
        {
          model: this.sequelize.models.book,
          include: [
            {
              model: this.sequelize.models.libraryItem
            },
            {
              model: this.sequelize.models.author,
              through: {
                attributes: []
              }
            },
            {
              model: this.sequelize.models.series,
              through: {
                attributes: ['sequence']
              }
            }
          ]
        },
        {
          model: this.sequelize.models.podcastEpisode,
          include: [
            {
              model: this.sequelize.models.podcast,
              include: this.sequelize.models.libraryItem
            }
          ]
        }
        // cast(b): sequelize accepts a single model or include object as a nested include, its types only allow an array
      ] as unknown as Includeable[],
      order: [['order', 'ASC']]
    })
  }

  /**
   * Get playlists toOldJSONExpanded
   */
  async getOldJsonExpanded() {
    this.playlistMediaItems = await this.getMediaItemsExpandedWithLibraryItem()
    return this.toOldJSONExpanded()
  }

  /**
   * Old model used libraryItemId instead of bookId
   *
   * @param [episodeId]
   */
  checkHasMediaItem(libraryItemId: string, episodeId?: string) {
    if (!this.playlistMediaItems) {
      throw new Error('playlistMediaItems are required to check Playlist')
    }
    if (episodeId) {
      return this.playlistMediaItems.some((pmi) => pmi.mediaItemId === episodeId)
    }
    // NOTE: a podcast episode media item has no libraryItem (it is on episode.podcast), so this throws a TypeError for playlists with episodes
    // cast(c): the JS reads libraryItem on every media item; see the NOTE above
    return this.playlistMediaItems.some((pmi) => (pmi.mediaItem as Book.BookExpandedWithLibraryItem).libraryItem.id === libraryItemId)
  }

  toOldJSON() {
    return {
      id: this.id,
      name: this.name,
      libraryId: this.libraryId,
      userId: this.userId,
      description: this.description,
      lastUpdate: this.updatedAt.valueOf(),
      createdAt: this.createdAt.valueOf()
    }
  }

  toOldJSONExpanded() {
    if (!this.playlistMediaItems) {
      throw new Error('playlistMediaItems are required to expand Playlist')
    }

    // Typed with items, which is added below
    const json: ReturnType<Playlist['toOldJSON']> & {
      items?: ({ libraryItemId: string; libraryItem: ReturnType<LibraryItem['toOldJSONExpanded']> } | { episodeId: string; episode: ReturnType<PodcastEpisode['toOldJSONExpanded']>; libraryItemId: string; libraryItem: ReturnType<LibraryItem['toOldJSONMinified']> })[]
    } = this.toOldJSON()
    json.items = this.playlistMediaItems.map((pmi) => {
      if (pmi.mediaItemType === 'book') {
        // cast(d): mediaItem is a Book (with its libraryItem) when mediaItemType is "book"
        const book = pmi.mediaItem as Book.BookExpandedWithLibraryItem
        const libraryItem = book.libraryItem
        // Same object as the book, typed with the association optional so it can be deleted
        const bookAssociations: { libraryItem?: LibraryItem } = book
        delete bookAssociations.libraryItem
        libraryItem.media = book
        return {
          libraryItemId: libraryItem.id,
          libraryItem: libraryItem.toOldJSONExpanded()
        }
      }

      // cast(d): mediaItem is a PodcastEpisode (with its podcast and its libraryItem) when mediaItemType is "podcastEpisode"
      const episode = pmi.mediaItem as PodcastEpisode & { podcast: Podcast.PodcastExpandedWithLibraryItem }
      const libraryItem = episode.podcast.libraryItem
      // Same object as the podcast, typed with the association optional so it can be deleted
      const podcastAssociations: { libraryItem?: LibraryItem } = episode.podcast
      delete podcastAssociations.libraryItem
      libraryItem.media = episode.podcast
      return {
        episodeId: pmi.mediaItemId,
        episode: episode.toOldJSONExpanded(libraryItem.id),
        libraryItemId: libraryItem.id,
        libraryItem: libraryItem.toOldJSONMinified()
      }
    })

    return json
  }
}

export = Playlist
