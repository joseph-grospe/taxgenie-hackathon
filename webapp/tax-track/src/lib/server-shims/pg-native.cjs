const error = new Error("Cannot find module 'pg-native'")
error.code = 'MODULE_NOT_FOUND'

throw error
