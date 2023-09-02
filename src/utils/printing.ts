import { print } from 'gluegun'

const { red, gray, white, bold } = print.colors

export function flame() {
  print.info(
    red(`    🔥🔥🔥  
    |  __| _🔥                      🔥_🔥   🔥🔥
    | |_  | | 🔥__  🔥🔥   🔥_🔥     / \\   |_ _|  
    | __| | |/ _\` || '  \\🔥/ -_)   🔥 _ \\   | |   
    |_|   |_|\\__,_||_|_|_| \\___|   /_/ \\_\\ |___|`)
  )
}

export function info(label: string, content: string) {
  print.info(`🔥 ${gray(label.padEnd(8))} ${white(content)}`)
}

export function br() {
  print.info('')
}

export function hr() {
  print.info('─'.repeat(51))
}

export function flameHeader() {
  br()
  hr()
  br()
  flame()
  print.info(`\n🔥 ${bold(red('Flame AI:'))} ${gray('Ignite your code with the power of AI.')}`)
  br()
  hr()
  br()
}
