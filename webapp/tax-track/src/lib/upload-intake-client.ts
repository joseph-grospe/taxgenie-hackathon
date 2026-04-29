import type { LocalUploadItem } from '@/lib/upload-intake-types'

export const toServerStatus = (status: string): LocalUploadItem['status'] => {
  switch (status) {
    case 'success':
    case 'completed':
      return 'Done'
    case 'duplicate':
      return 'Duplicate'
    case 'error':
      return 'Error'
    case 'processing':
      return 'Processing'
    case 'queued':
    case 'uploaded':
      return 'Queued'
    default:
      return 'Pending'
  }
}

export const xhrPut = (
  url: string,
  file: File,
  headers: Record<string, string>,
  onProgress: (value: number) => void,
) =>
  new Promise<void>((resolve, reject) => {
    const request = new XMLHttpRequest()
    request.open('PUT', url)
    Object.entries(headers).forEach(([key, value]) => {
      request.setRequestHeader(key, value)
    })
    request.upload.onprogress = (event) => {
      if (!event.lengthComputable) {
        return
      }

      onProgress(Math.round((event.loaded / event.total) * 100))
    }
    request.onload = () => {
      if (request.status >= 200 && request.status < 300) {
        onProgress(100)
        resolve()
        return
      }

      reject(new Error(`Upload failed with status ${request.status}.`))
    }
    request.onerror = () => reject(new Error('Network error during S3 upload.'))
    request.send(file)
  })
