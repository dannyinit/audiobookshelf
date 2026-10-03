/**
 * Called when a track starts
 * @param trackIndex - The index of the track that started.
 */
type TrackStartedCallback = (trackIndex: number) => void

/**
 * Called when progress is updated
 * @param trackIndex - The index of the current track.
 * @param progressInTrack - The current track progress in percent.
 * @param totalProgress - The total progress in percent.
 */
type ProgressCallback = (trackIndex: number, progressInTrack: number, totalProgress: number) => void

/**
 * Called when a track finishes
 * @param trackIndex - The index of the track that finished.
 */
type TrackFinishedCallback = (trackIndex: number) => void

class TrackProgressMonitor {
  declare trackDurations: number[]
  declare totalDuration: number
  declare trackStartedCallback: TrackStartedCallback
  declare progressCallback: ProgressCallback
  declare trackFinishedCallback: TrackFinishedCallback
  declare currentTrackIndex: number
  declare cummulativeProgress: number
  declare currentTrackPercentage: number
  declare numTracks: number
  declare allTracksFinished: boolean
  declare currentTrackProgress: number

  /**
   * Creates a new TrackProgressMonitor.
   * @constructor
   * @param trackDurations - The durations of the tracks in seconds.
   * @param trackStartedCallback - The callback to call when a track starts.
   * @param progressCallback - The callback to call when progress is updated.
   * @param trackFinishedCallback - The callback to call when a track finishes.
   */
  constructor(trackDurations: number[], trackStartedCallback: TrackStartedCallback, progressCallback: ProgressCallback, trackFinishedCallback: TrackFinishedCallback) {
    this.trackDurations = trackDurations
    this.totalDuration = trackDurations.reduce((total, duration) => total + duration, 0)
    this.trackStartedCallback = trackStartedCallback
    this.progressCallback = progressCallback
    this.trackFinishedCallback = trackFinishedCallback
    this.currentTrackIndex = -1
    this.cummulativeProgress = 0
    this.currentTrackPercentage = 0
    this.numTracks = this.trackDurations.length
    this.allTracksFinished = false
    this.#moveToNextTrack()
  }

  #outsideCurrentTrack(progress: number) {
    this.currentTrackProgress = progress - this.cummulativeProgress
    return this.currentTrackProgress >= this.currentTrackPercentage
  }

  #moveToNextTrack() {
    if (this.currentTrackIndex >= 0) this.#trackFinished()
    this.currentTrackIndex++
    this.cummulativeProgress += this.currentTrackPercentage
    if (this.currentTrackIndex >= this.numTracks) {
      this.allTracksFinished = true
      return
    }
    this.currentTrackPercentage = (this.trackDurations[this.currentTrackIndex] / this.totalDuration) * 100
    this.#trackStarted()
  }

  #trackStarted() {
    this.trackStartedCallback(this.currentTrackIndex)
  }

  #progressUpdated(totalProgress: number) {
    const progressInTrack = (this.currentTrackProgress / this.currentTrackPercentage) * 100
    this.progressCallback(this.currentTrackIndex, progressInTrack, totalProgress)
  }

  #trackFinished() {
    this.trackFinishedCallback(this.currentTrackIndex)
  }

  /**
   * Updates the track progress based on the total progress.
   * @param totalProgress - The total progress in percent.
   */
  update(totalProgress: number) {
    while (this.#outsideCurrentTrack(totalProgress) && !this.allTracksFinished) this.#moveToNextTrack()
    if (!this.allTracksFinished) this.#progressUpdated(totalProgress)
  }

  /**
   * Finish the track progress monitoring.
   * Forces all remaining tracks to finish.
   */
  finish() {
    this.update(101)
  }
}
export = TrackProgressMonitor
