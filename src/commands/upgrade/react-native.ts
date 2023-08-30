import { GluegunCommand } from 'gluegun'
import { chatGPTPrompt } from '../../ai/openai'
import { parseGitDiff } from '../../utils/parseGitDiff'
import { ChatCompletionFunction } from '../../types'
import { patch } from '../../ai/functions/patch'
import { createFile } from '../../ai/functions/createFile'
import { deleteFile } from '../../ai/functions/deleteFile'
import { createUpgradeRNPrompts } from '../../ai/prompts/upgradeReactNativePrompts'
import { spin, done, hide, stop, error } from '../../utils/spin'
import { summarize } from '../../utils/summarize'
import { checkGitStatus } from '../../utils/checkGitStatus'
import { coloredDiff } from '../../utils/coloredDiff'
import { ChatCompletionRequestMessage, ChatCompletionResponseMessage } from 'openai'
import { fetchRNAppInfo } from '../../react-native/fetchRNAppInfo'
import { br, flame, hr, info } from '../../utils/out'
import { fetchRNDiff } from '../../react-native/fetchRNDiff'
import { isFileIgnored } from '../../react-native/isFileIgnored'

const ignoreFiles = [
  'README.md',
  // more files here if needed
]

const command: GluegunCommand = {
  name: 'react-native',
  alias: ['rn'],
  run: async (toolbox) => {
    const { print, filesystem, http, parameters, prompt } = toolbox
    const { options } = parameters
    const { colors } = print
    const { gray, red, cyan, white, bold } = colors

    const log = (t: any) => options.debug && console.log(t)

    // Retrieve the path of the folder to upgrade, default current folder.
    const dir = parameters.first || './'

    // Make sure the git repo is clean before we start (warn if not)
    await checkGitStatus(toolbox)

    const seeDiffs = options.diffs !== false

    hr()
    flame()

    print.info(`🔥 ${bold(red('Flame AI:'))} ${gray('Ignite your code with the power of AI.')}`)
    hr()
    info('App:', filesystem.path(dir))
    info('Mode:', options.interactive ? `Interactive` : `Upgrade`)

    spin('Fetching app info')
    const appInfo = await fetchRNAppInfo({ dir, options })
    if (appInfo.error) return stop('🙈', appInfo.error)
    const { currentVersion, targetVersion, replacePlaceholder } = appInfo
    hide()

    info('Current:', bold(currentVersion))
    info('Upgrade:', bold(targetVersion))

    spin('Fetching upgrade diff')
    const { files, error: diffError } = await fetchRNDiff({ currentVersion, targetVersion })
    if (diffError) return stop('🙈', diffError)
    hide()

    // if they pass --list, just list the files and exit
    if (options.list) {
      for (const f in files) print.success(f)
      return
    }

    hr()

    print.info(bold(white(`Starting ${cyan('React Native')} upgrade using ${red(bold('Flame AI'))}\n`)))

    let userWantsToExit = false
    for (const file in files) {
      const fileData = files[file]
      const fileDiff = replacePlaceholder(fileData.diff)

      if (isFileIgnored({ ignoreFiles, only: options.only, fileData })) continue

      // Replace the RnDiffApp placeholder with the app name
      const localFile = replacePlaceholder(file)

      // load the file from the filesystem
      const sourceFileContents = await filesystem.readAsync(localFile)

      // if the file doesn't exist, skip it
      if (!sourceFileContents) {
        // stop('🙈', `Couldn't find ${localFile}, skipping`)
        print.info(`↠ Skipping: ${localFile} (file not found)`)
        br()
        fileData.change = 'skipped'
        fileData.error = 'file not found'
        continue
      }

      // stop the spinner temporarily to ask the user a question
      hide()
      print.info(`${bold('■ File: ')} ${localFile}`)
      br()

      // check if the user wants to convert the next file or skip this file
      let skipFile = 'upgrade'
      if (options.interactive) {
        if (seeDiffs) print.info(white('Upgrade Helper diff:\n\n') + coloredDiff(fileDiff) + '\n')

        const skipAnswer = await prompt.ask({
          type: 'select',
          name: 'skipFile',
          message: 'Do you want to upgrade this file?',
          choices: [
            { message: `Start upgrading ${localFile}`, name: 'upgrade' },
            { message: 'Skip this file', name: 'skip' },
            { message: 'Exit', name: 'exit' },
          ],
        })

        skipFile = skipAnswer['skipFile']
      }

      br()

      log({ skipFile })

      if (skipFile === 'skip') {
        fileData.change = 'skipped'
        continue
      } else if (skipFile === 'exit') {
        userWantsToExit = true
        break
      } // else, we're good!

      const { orientation, convertPrompt, admonishments } = createUpgradeRNPrompts({
        from: currentVersion,
        to: targetVersion,
        file: localFile,
        contents: sourceFileContents,
        diff: fileDiff,
      })

      let doneWithFile = false
      while (!doneWithFile) {
        // Restart the spinner for the current file
        spin(`Upgrading ${localFile}`)

        // We'll let the AI patch files and create files
        const functions: ChatCompletionFunction[] = [patch, createFile, deleteFile]

        const messages: ChatCompletionRequestMessage[] = [
          { content: orientation, role: 'system' },
          { content: convertPrompt, role: 'user' },
          ...fileData.customPrompts.map((i) => ({
            content: `In addition: ${i}`,
            role: 'user' as const,
          })),
          { content: admonishments, role: 'system' },
        ]

        let response: ChatCompletionResponseMessage = undefined

        if (options.cacheFile) {
          const cacheFile = options.cacheFile
          // load the existing cache file
          const cacheData = await filesystem.readAsync(cacheFile, 'json')
          // check if a recording for this request exists
          if (cacheData?.request[localFile]) {
            response = cacheData.request[localFile]
          }
        }

        if (response) {
          // delay briefly to simulate a real request
          await new Promise((resolve) => setTimeout(resolve, 2500))
          stop('🔥', `Using cached response for ${localFile}`)
        } else {
          response = await chatGPTPrompt({
            functions,
            messages,
            model: 'gpt-4',
          })

          if (options.cacheFile) {
            // load the existing cache file
            const cacheData = (await filesystem.readAsync(options.cacheFile, 'json')) || { request: {} }

            // add the request and response to the cache file
            cacheData.request[localFile] = response

            // write it back
            await filesystem.writeAsync(options.cacheFile, cacheData, { jsonIndent: 2 })
          }
        }

        hide()

        log({ response })

        const functionName = response?.function_call?.name
        try {
          var functionArgs = JSON.parse(response?.function_call?.arguments || '{}')
        } catch (e) {
          print.error(`🛑 Error parsing function arguments: ${e.message}`)
          print.error(`   ${response?.function_call?.arguments}`)

          const cont = options.interactive ? await prompt.confirm('Try again?') : false
          if (cont) continue

          // skip this file
          fileData.change = 'skipped'
          fileData.error = 'unknown error'
          doneWithFile = true
          continue
        }

        // Look up function in the registry and call it with the parsed arguments
        const func = functionName && functions.find((f) => f.name === functionName)

        if (!func) {
          // If there's no function call, maybe there's content to display?
          if (response.content) {
            print.info(response.content)

            // if we're being rate limited, we need to stop for a bit and try again
            if (response.content.includes('too_many_requests')) {
              print.error(`🛑 I'm being rate limited. Wait a while and try again.\n`)
              await prompt.confirm('Press enter to continue')
            } else if (response.content.includes('context_length_exceeded')) {
              const len = sourceFileContents.length
              print.error(`🛑 File is too long (${len} characters), skipping! Not enough tokens.`)
              fileData.change = 'skipped'
              fileData.error = 'file too long'
              doneWithFile = true
            } else if (response.content.includes('unknown_error')) {
              print.error(`🛑 Unknown error, skipping!`)
              fileData.change = 'skipped'
              fileData.error = 'unknown error'
              doneWithFile = true
            }
          }
          continue
        }

        const result = await func.fn(functionArgs)

        log({ result })

        // fileData.changes = result.changes

        done(`I've made changes to the file ${localFile}.`)
        br()

        if (func.name === 'createFile') {
          fileData.change = 'created'
        } else if (func.name === 'patch') {
          fileData.change = 'modified'
        } else if (func.name === 'deleteFile') {
          fileData.change = 'deleted'
        }

        // if not interactive, just keep the changes and move on to the next file
        if (!options.interactive) {
          doneWithFile = true
          continue
        }

        // interactive mode allows the user to undo the changes and give more instructions
        if (seeDiffs) {
          if (result.changes.split('\n').length === 0) {
            print.info(`⇾ No changes made to file.`)
          } else if (result.changes.split('\n').length <= 20) {
            print.info(result.changes + '\n')
          } else {
            print.info(`⇾ Many changes made to file -- choose "See all changes" to see them.`)
            print.info(`  Or check your code editor (probably easier)`)
          }
        }

        let keepChanges: { keepChanges: string } = undefined
        while (true) {
          keepChanges = await prompt.ask({
            type: 'select',
            name: 'keepChanges',
            message: 'Review the changes and let me know what to do next!',
            choices: [
              { message: 'Looks good! Next file please', name: 'next' },
              { message: 'Try again (and ask me for advice)', name: 'retry' },
              { message: 'See all changes to file', name: 'changes' },
              { message: 'See original diff again', name: 'diff' },
              ...(options.cacheFile ? [{ message: 'Remove cache for this file', name: 'removeCache' }] : []),
              { message: 'Skip this file (undo changes)', name: 'skip' },
              { message: 'Exit (keep changes to this file)', name: 'keepExit' },
              { message: 'Exit (undo changes to this file)', name: 'undoExit' },
            ],
          })

          if (keepChanges?.keepChanges === 'removeCache') {
            // load the existing cache file
            const demoData = (await filesystem.readAsync(options.cacheFile, 'json')) || { request: {} }
            // remove the request and response to the demo file
            delete demoData.request[localFile]
            // write it back
            await filesystem.writeAsync(options.cacheFile, demoData, { jsonIndent: 2 })
            br()
            print.info(`↺  Cache removed for ${localFile}.`)
            br()
            continue
          }

          if (keepChanges?.keepChanges === 'changes') {
            br()
            print.info(result.changes)
            br()
            continue
          }

          if (keepChanges?.keepChanges === 'diff') {
            br()
            print.info(gray(fileData.diff))
            br()
            continue
          }

          break
        }

        log({ keepChanges })

        if (keepChanges?.keepChanges === 'next') {
          doneWithFile = true
        } else if (keepChanges?.keepChanges === 'skip') {
          doneWithFile = true
          await result.undo()
          br()
          print.info(`↺  Changes to ${localFile} undone.`)
          fileData.change = 'skipped'
        } else if (keepChanges?.keepChanges === 'keepExit') {
          doneWithFile = true
          userWantsToExit = true
        } else if (keepChanges?.keepChanges === 'undoExit') {
          doneWithFile = true
          userWantsToExit = true
          await result.undo()
          br()
          print.info(`↺  Changes to ${localFile} undone.`)
          fileData.change = 'skipped'
        } else if (keepChanges?.keepChanges === 'retry') {
          br()
          print.info('⇾ Any advice to help me convert this file better?')
          br()
          fileData.customPrompts.forEach((i) => print.info(gray(`   ${i}\n`)))

          const nextInstructions = await prompt.ask({
            type: 'input',
            name: 'nextInstructions',
            message: 'Prompt',
          })

          br()

          // typing "exit" always gets out of the CLI
          if (nextInstructions?.nextInstructions === 'exit') {
            userWantsToExit = true
            break
          }

          // undo the changes made so we can try again
          await result.undo()

          fileData.customPrompts.push(nextInstructions.nextInstructions)

          fileData.change = 'pending'

          // also remove the cache for this file
          if (options.cacheFile) {
            // load the existing cache file
            const cacheData = (await filesystem.readAsync(options.cacheFile, 'json')) || { request: {} }
            // remove the request and response to the cache file
            delete cacheData.request[localFile]
            // write it back
            await filesystem.writeAsync(options.cacheFile, cacheData, { jsonIndent: 2 })
            br()
            print.info(`↺  Cache removed for ${localFile}.`)
            br()
          }
        } else {
          br()
          print.error(`Something went wrong.`)
          log({ keepChanges })
          fileData.change = 'pending'
          fileData.error = 'something went wrong'
        }
      }

      br()

      if (userWantsToExit) break
    }

    // Print a summary of the changes
    summarize(Object.values(files), print, replacePlaceholder, br, hr)

    hr()
    print.info(bold(white(`Done!\n`)))
  },
}

module.exports = command
