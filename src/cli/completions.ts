export type CompletionShell = "bash" | "zsh" | "fish"

const bash = `# bash completion for dbm
_dbm_complete() {
  local current previous
  current="\${COMP_WORDS[COMP_CWORD]}"
  previous="\${COMP_WORDS[COMP_CWORD-1]}"
  if [[ "$previous" == "completions" ]]; then
    COMPREPLY=( $(compgen -W "bash zsh fish" -- "$current") )
  elif [[ "$previous" == "doctor" ]]; then
    COMPREPLY=( $(compgen -W "--json" -- "$current") )
  else
    COMPREPLY=( $(compgen -W "doctor completions --help --version" -- "$current") )
  fi
}
complete -F _dbm_complete dbm
`

const zsh = `#compdef dbm
_dbm() {
  _arguments \\
    '(-h --help)'{-h,--help}'[show help]' \\
    '(-v --version)'{-v,--version}'[show version]' \\
    '1:command:(doctor completions)' \\
    '2:option or shell:(--json bash zsh fish)'
}
_dbm "$@"
`

const fish = `complete -c dbm -f
complete -c dbm -n '__fish_use_subcommand' -a doctor -d 'Check the local dbm environment'
complete -c dbm -n '__fish_use_subcommand' -a completions -d 'Print shell completions'
complete -c dbm -n '__fish_seen_subcommand_from doctor' -l json -d 'Print JSON'
complete -c dbm -n '__fish_seen_subcommand_from completions' -a 'bash zsh fish'
complete -c dbm -s h -l help -d 'Show help'
complete -c dbm -s v -l version -d 'Show version'
`

export const completionFor = (shell: CompletionShell): string => {
  switch (shell) {
    case "bash":
      return bash
    case "zsh":
      return zsh
    case "fish":
      return fish
  }
}

export const isCompletionShell = (value: string | undefined): value is CompletionShell =>
  value === "bash" || value === "zsh" || value === "fish"
