export const MANILA_TIME_ZONE = 'Asia/Manila'

export const createManilaDateFormatter = (
  locales: Intl.LocalesArgument,
  options: Intl.DateTimeFormatOptions,
) =>
  new Intl.DateTimeFormat(locales, {
    ...options,
    timeZone: MANILA_TIME_ZONE,
  })
