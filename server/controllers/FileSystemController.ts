import type { Response } from 'express'
import Path = require('path')
import Logger = require('../Logger')
import fs = require('../libs/fsExtra')
import utils = require('../utils/index')
import fileUtils = require('../utils/fileUtils')
import Database = require('../Database')
import type { RequestWithUser } from './types'

const { toNumber } = utils

class FileSystemController {
  constructor() {}

  async getPaths(req: RequestWithUser, res: Response) {
    if (!req.user.isAdminOrUp) {
      Logger.error(`[FileSystemController] Non-admin user "${req.user.username}" attempting to get filesystem paths`)
      return res.sendStatus(403)
    }

    // cast(d): query value
    const relpath = req.query.path as string | undefined
    const level = toNumber(req.query.level, 0)

    // Validate path. Must be absolute
    if (relpath && (!Path.isAbsolute(relpath) || !(await fs.pathExists(relpath)))) {
      Logger.error(`[FileSystemController] Invalid path in query string "${relpath}"`)
      return res.status(400).send('Invalid "path" query string')
    }
    Logger.debug(`[FileSystemController] Getting file paths at ${relpath || 'root'} (${level})`)

    let directories: { path: string; dirname: string; level: number }[] = []

    // Windows returns drives first
    if (global.isWin) {
      if (relpath) {
        directories = await fileUtils.getDirectoriesInPath(relpath, level)
      } else {
        const drives = await fileUtils.getWindowsDrives().catch((error) => {
          Logger.error(`[FileSystemController] Failed to get windows drives`, error)
          return []
        })
        if (drives.length) {
          directories = drives.map((d) => {
            return {
              path: d,
              dirname: d,
              level: 0
            }
          })
        }
      }
    } else {
      directories = await fileUtils.getDirectoriesInPath(relpath || '/', level)
    }

    // Exclude some dirs from this project to be cleaner in Docker
    const excludedDirs = ['node_modules', 'client', 'server', '.git', 'static', 'build', 'dist', 'metadata', 'config', 'sys', 'proc', '.devcontainer', '.nyc_output', '.github', '.vscode'].map((dirname) => {
      return fileUtils.filePathToPOSIX(Path.join(global.appRoot, dirname))
    })
    directories = directories.filter((dir) => {
      return !excludedDirs.includes(dir.path)
    })

    res.json({
      posix: !global.isWin,
      directories
    })
  }

  /**
   * POST: /api/filesystem/pathexists
   */
  async checkPathExists(req: RequestWithUser, res: Response) {
    if (!req.user.canUpload) {
      Logger.error(`[FileSystemController] User "${req.user.username}" without upload permissions attempting to check path exists`)
      return res.sendStatus(403)
    }

    const { directory, folderPath } = req.body
    if (!directory?.length || typeof directory !== 'string' || !folderPath?.length || typeof folderPath !== 'string') {
      Logger.error(`[FileSystemController] Invalid request body: ${JSON.stringify(req.body)}`)
      return res.status(400).json({
        error: 'Invalid request body'
      })
    }

    // Check that library folder exists
    const libraryFolder = await Database.libraryFolderModel.findOne({
      where: {
        path: folderPath
      }
    })

    if (!libraryFolder) {
      Logger.error(`[FileSystemController] Library folder not found: ${folderPath}`)
      return res.sendStatus(404)
    }

    if (!req.user.checkCanAccessLibrary(libraryFolder.libraryId)) {
      Logger.error(`[FileSystemController] User "${req.user.username}" attempting to check path exists for library "${libraryFolder.libraryId}" without access`)
      return res.sendStatus(403)
    }

    let filepath = Path.join(libraryFolder.path, directory)
    filepath = fileUtils.filePathToPOSIX(filepath)

    // Ensure filepath is inside library folder (prevents directory traversal)
    if (!fileUtils.isSameOrSubPath(libraryFolder.path, filepath)) {
      Logger.error(`[FileSystemController] Filepath is not inside library folder: ${filepath}`)
      return res.sendStatus(400)
    }

    if (await fs.pathExists(filepath)) {
      return res.json({
        exists: true
      })
    }

    // Check if a library item exists in a subdirectory
    // See: https://github.com/advplyr/audiobookshelf/issues/4146
    const cleanedDirectory = directory.split('/').filter(Boolean).join('/')
    if (cleanedDirectory.includes('/')) {
      // Can only be 2 levels deep
      const possiblePaths: string[] = []
      const subdir = Path.dirname(directory)
      possiblePaths.push(fileUtils.filePathToPOSIX(Path.join(folderPath, subdir)))
      if (subdir.includes('/')) {
        possiblePaths.push(fileUtils.filePathToPOSIX(Path.join(folderPath, Path.dirname(subdir))))
      }

      const libraryItem = await Database.libraryItemModel.findOne({
        where: {
          path: possiblePaths
        }
      })

      if (libraryItem) {
        return res.json({
          exists: true,
          libraryItemTitle: libraryItem.title
        })
      }
    }

    return res.json({
      exists: false
    })
  }
}
export = new FileSystemController()
