import xml2js from 'xml2js'
import Logger = require('../../Logger')

/**
 * Overdrive media marker after its values are converted to strings
 */
interface OverdriveMediaMarker {
  Name: string
  Time: string
  [key: string]: string
}

/**
 * MediaMarkers XML as parsed by xml2js (values are arrays)
 */
interface OverdriveMarkersXml {
  Markers?: {
    Marker?: Record<string, unknown[]>[]
  }
}

/**
 * Audio file fields used (see objects/files/AudioFile)
 */
interface OverdriveAudioFile {
  duration: number
  metaTags: {
    tagOverdriveMediaMarker?: string | null
  }
}

interface OverdriveChapter {
  id: number
  start: number
  end?: number
  title: string
}

// given the array of Overdrive Media Markers from generateOverdriveMediaMarkers()
//  parse and clean them in to something a bit more usable
function cleanOverdriveMediaMarkers(overdriveMediaMarkers: string[]): OverdriveMediaMarker[][] {
  Logger.debug('[parseOverdriveMediaMarkers] Cleaning up overdrive media markers')
  /*
  returns an array of arrays of objects. Each inner array corresponds to an audio track, with it's objects being a chapter:
  [
    [
     {
      "Name": "Chapter 1",
      "Time": "0:00.000"
    },
    {
      "Name": "Chapter 2",
      "Time": "15:51.000"
    },
    { etc }
    ]
  ]
  */

  const parsedOverdriveMediaMarkers: OverdriveMediaMarker[][] = []
  overdriveMediaMarkers.forEach((item, index) => {
    let parsed_result: OverdriveMediaMarker[] | null = null
    // convert xml to JSON
    xml2js.parseString(item, function (err: Error | null, result: OverdriveMarkersXml | undefined) {
      /*
      result.Markers.Marker is the result of parsing the XML for the MediaMarker tags for the MP3 file (Part##.mp3)
      it is shaped like this, and needs further cleaning below:
      [
        {
          "Name": [
              "Chapter 1:  "
          ],
          "Time": [
              "0:00.000"
          ]
        },
        {
          ANOTHER CHAPTER
        },
      ]
      */

      // The values for Name and Time in results.Markers.Marker are returned as Arrays from parseString and should be strings
      if (result?.Markers?.Marker) {
        parsed_result = objectValuesArrayToString(result.Markers.Marker)
      }
    })

    if (parsed_result) {
      parsedOverdriveMediaMarkers.push(parsed_result)
    }
  })

  return removeExtraChapters(parsedOverdriveMediaMarkers)
}

// given an array of objects, convert any values that are arrays to strings
function objectValuesArrayToString(arrayOfObjects: Record<string, unknown>[]): OverdriveMediaMarker[] {
  Logger.debug('[parseOverdriveMediaMarkers] Converting Marker object values from arrays to strings')
  arrayOfObjects.forEach((item) => {
    Object.keys(item).forEach((key) => {
      // cast(a): xml2js output is untyped; its values are arrays (never null)
      item[key] = (item[key] as unknown[]).toString()
    })
  })

  // cast(d): every value was converted to a string above; Name and Time come from the MediaMarker XML
  return arrayOfObjects as OverdriveMediaMarker[]
}

// Overdrive sometimes has weird chapters and subchapters defined
//  These aren't necessary, so lets remove them
function removeExtraChapters(parsedOverdriveMediaMarkers: OverdriveMediaMarker[][]): OverdriveMediaMarker[][] {
  Logger.debug('[parseOverdriveMediaMarkers] Removing any unnecessary chapters')
  const weirdChapterFilterRegex = /([(]\d|[cC]ontinued)/
  var cleaned: OverdriveMediaMarker[][] = []
  parsedOverdriveMediaMarkers.forEach(function (item) {
    cleaned.push(item.filter((chapter) => !weirdChapterFilterRegex.test(chapter.Name)))
  })

  return cleaned
}

// Given a set of chapters from generateParsedChapters, add the end time to each one
function addChapterEndTimes(chapters: OverdriveChapter[], totalAudioDuration: number): OverdriveChapter[] {
  Logger.debug('[parseOverdriveMediaMarkers] Adding chapter end times')
  chapters.forEach((chapter, chapter_index) => {
    if (chapter_index < chapters.length - 1) {
      chapter.end = chapters[chapter_index + 1].start
    } else {
      chapter.end = totalAudioDuration
    }
  })

  return chapters
}

// The function that actually generates the Chapters object that we update ABS with
function generateParsedChapters(includedAudioFiles: OverdriveAudioFile[], cleanedOverdriveMediaMarkers: OverdriveMediaMarker[][]): OverdriveChapter[] {
  Logger.debug('[parseOverdriveMediaMarkers] Generating new chapters for ABS')
  // logic ported over from benonymity's OverdriveChapterizer:
  //    https://github.com/benonymity/OverdriveChapterizer/blob/main/chapters.py
  var parsedChapters: OverdriveChapter[] = []
  var length = 0.0
  var index = 0
  var time = 0.0

  // cleanedOverdriveMediaMarkers is an array of array of objects, where the inner array matches to the included audio files tracks
  //     this allows us to leverage the individual track durations when calculating the start times of chapters in tracks after the first (using length)
  // TODO: can we guarantee the inner array matches the included audio files?
  includedAudioFiles.forEach((track, track_index) => {
    cleanedOverdriveMediaMarkers[track_index].forEach((chapter) => {
      let timeParts = chapter.Time.split(':')
      // add seconds
      // cast(d): split always returns at least one element, so pop is not undefined
      time = length + parseFloat(timeParts.pop() as string)
      if (timeParts.length) {
        // add minutes
        // cast(d): timeParts.length was checked above, so pop is not undefined
        time += parseFloat(timeParts.pop() as string) * 60
      }
      if (timeParts.length) {
        // add hours
        // cast(d): timeParts.length was checked above, so pop is not undefined
        time += parseFloat(timeParts.pop() as string) * 3600
      }
      var newChapterData = {
        id: index++,
        start: time,
        title: chapter.Name
      }
      parsedChapters.push(newChapterData)
    })
    length += track.duration
  })

  parsedChapters = addChapterEndTimes(parsedChapters, length) // we need all the start times sorted out before we can add the end times

  return parsedChapters
}

const parseOverdriveMediaMarkersAsChapters = (includedAudioFiles: OverdriveAudioFile[]): OverdriveChapter[] | null => {
  const overdriveMediaMarkers = includedAudioFiles.map((af) => af.metaTags.tagOverdriveMediaMarker).filter((af): af is string => !!af) || []
  if (!overdriveMediaMarkers.length) return null

  var cleanedOverdriveMediaMarkers = cleanOverdriveMediaMarkers(overdriveMediaMarkers)
  // TODO: generateParsedChapters requires overdrive media markers and included audio files length to be the same
  //         so if not equal then we must exit
  if (cleanedOverdriveMediaMarkers.length !== includedAudioFiles.length) return null
  return generateParsedChapters(includedAudioFiles, cleanedOverdriveMediaMarkers)
}

export = { parseOverdriveMediaMarkersAsChapters }
