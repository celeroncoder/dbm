import { Effect } from "effect"
import { InputError } from "./errors"
import type { QueryResult } from "./model"

export const emptyResult = (columns: ReadonlyArray<string> = []): QueryResult => ({
  columns,
  rows: [],
  rowCount: 0,
  truncated: false
})

export const parseCsv = (input: string): ReadonlyArray<ReadonlyArray<string>> => {
  const rows: Array<Array<string>> = []
  let row: Array<string> = []
  let cell = ""
  let quoted = false

  const pushCell = () => {
    row.push(cell)
    cell = ""
  }

  const pushRow = () => {
    if (row.length > 0 || cell !== "") {
      pushCell()
    }
    if (row.length > 0) {
      rows.push(row)
    }
    row = []
  }

  for (let index = 0; index < input.length; index += 1) {
    const character = input[index]
    const next = input[index + 1]
    if (quoted) {
      if (character === '"' && next === '"') {
        cell += '"'
        index += 1
      } else if (character === '"') {
        quoted = false
      } else {
        cell += character
      }
      continue
    }

    if (character === '"' && cell === "") {
      quoted = true
    } else if (character === ",") {
      pushCell()
    } else if (character === "\n") {
      pushRow()
    } else if (character !== "\r") {
      cell += character
    }
  }

  if (quoted) {
    cell = `"${cell}`
  }
  if (cell !== "" || row.length > 0) {
    pushRow()
  }

  return rows
}

export const parseTsv = (input: string): ReadonlyArray<ReadonlyArray<string>> =>
  input
    .split("\n")
    .map((line) => line.replace(/\r$/, ""))
    .filter((line) => line !== "")
    .map((line) => line.split("\t"))

export const csvToQueryResult = (input: string, nullValue = "NULL"): QueryResult => {
  const rows = parseCsv(input)
  if (rows.length === 0) {
    return emptyResult()
  }
  const columns = rows[0] ?? []
  const data = rows.slice(1)
  return {
    columns,
    rows: data.map((row) => row.map((value) => (value === nullValue ? null : value))),
    rowCount: data.length,
    truncated: false
  }
}

export const tsvToQueryResult = (input: string, nullValue = "\\N"): QueryResult => {
  const rows = parseTsv(input)
  if (rows.length === 0) {
    return emptyResult()
  }
  const columns = rows[0] ?? []
  const data = rows.slice(1)
  return {
    columns,
    rows: data.map((row) => row.map((value) => (value === nullValue ? null : value))),
    rowCount: data.length,
    truncated: false
  }
}

export const tokenizeCommand = (input: string): Effect.Effect<ReadonlyArray<string>, InputError> =>
  Effect.try({
    try: () => {
      const tokens: Array<string> = []
      let token = ""
      let quote: "'" | '"' | undefined
      let escaped = false

      const push = () => {
        if (token !== "") {
          tokens.push(token)
          token = ""
        }
      }

      for (const character of input.trim()) {
        if (escaped) {
          token += character
          escaped = false
        } else if (character === "\\") {
          escaped = true
        } else if (quote !== undefined) {
          if (character === quote) {
            quote = undefined
          } else {
            token += character
          }
        } else if (character === '"' || character === "'") {
          quote = character
        } else if (/\s/.test(character)) {
          push()
        } else {
          token += character
        }
      }

      if (escaped || quote !== undefined) {
        throw new Error("Unclosed quote or escape sequence.")
      }
      push()
      return tokens
    },
    catch: (cause) =>
      InputError.make({
        message: cause instanceof Error ? cause.message : String(cause)
      })
  })
