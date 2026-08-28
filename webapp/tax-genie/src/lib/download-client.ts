const extractAttachmentFileName = (
  response: Response,
  fallbackFileName: string,
) => {
  const disposition = response.headers.get('content-disposition') ?? ''
  const fileNameMatch =
    disposition.match(/filename="([^"]+)"/i) ??
    disposition.match(/filename=([^;]+)/i)

  return fileNameMatch?.[1]?.trim() || fallbackFileName
}

export const downloadResponseAttachment = async (
  response: Response,
  fallbackFileName: string,
) => {
  const blob = await response.blob()
  const fileName = extractAttachmentFileName(response, fallbackFileName)
  const objectUrl = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = objectUrl
  anchor.download = fileName
  document.body.append(anchor)
  anchor.click()
  anchor.remove()
  URL.revokeObjectURL(objectUrl)

  return fileName
}
