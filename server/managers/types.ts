/**
 * Types shared by the managers in server/managers.
 */

/**
 * File uploaded with express-fileupload (req.files.<name>), only what the managers use
 */
export interface UploadedFile {
  name: string
  mv(path: string): Promise<void>
}
