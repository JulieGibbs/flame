// export types

import { ChatCompletionRequestMessage } from 'openai'

export type Message = ChatCompletionRequestMessage

/**
 * Context includes tasks that we are working on, files that we have opened,
 * and previous messages that we have sent.
 *
 * With that information, we can provide a better, more relevant backchat.
 *
 * It gets updated in the flame-history.json file that is created in src/utils/chatHistory.ts.
 */
export type SmartContext = {
  // Project context, continually updated
  project: string // "flame is a gluegun cli that uses AI to modify code"

  // working folder
  workingFolder: string

  // Files we have loaded
  files: {
    [path: string]: {
      path: string
      contents?: string // if undefined, we haven't actually loaded it, but listed the filenames/paths
      embeddings?: number[]
      shortened?: string
    }
  }

  // Current file we are working on
  currentFile?: string

  // Description of current task we are working on
  currentTask?: string

  // Previous messages we have sent
  messages: Message[]

  // Embeddings for the current task + last several messages
  currentTaskEmbeddings?: number[]
}

export type ListFilesOptions = {
  recursive?: boolean
  ignore?: string[]
}
