import type {
  ColumnInfo,
  ContainerPort,
  DetectedDatabase,
  QueryResult,
  SchemaInfo,
  TableInfo
} from "../core/model"
import { displayDatabaseKind } from "../core/discovery"

const displayCell = (value: string | null): string =>
  value === null ? "NULL" : value.replaceAll("\n", "\\n")

export const renderQueryResult = (result: QueryResult, maxRows = 100): string => {
  if (result.columns.length === 0) {
    return result.note ?? "(no rows)"
  }

  const rows = result.rows.slice(0, maxRows).map((row) =>
    result.columns.map((_column, index) => displayCell(row[index] ?? null))
  )
  const widths = result.columns.map((column, index) =>
    Math.min(
      40,
      Math.max(column.length, ...rows.map((row) => Math.min(40, row[index]?.length ?? 0)))
    )
  )
  const formatRow = (row: ReadonlyArray<string>): string =>
    `│ ${row.map((cell, index) => {
      const width = widths[index] ?? cell.length
      return cell.slice(0, width).padEnd(width)
    }).join(" │ ")} │`
  const separator = `├─${widths.map((width) => "─".repeat(width)).join("─┼─")}─┤`
  const header = formatRow(result.columns)
  const body = rows.map(formatRow)
  const footer = result.truncated || result.rows.length > maxRows
    ? `Showing ${Math.min(result.rows.length, maxRows)} of ${result.rowCount} rows.`
    : `${result.rowCount} row${result.rowCount === 1 ? "" : "s"}.`
  return [`┌─${widths.map((width) => "─".repeat(width)).join("─┬─")}─┐`, header, separator, ...body, `└─${widths.map((width) => "─".repeat(width)).join("─┴─")}─┘`, footer].join("\n")
}

const renderPorts = (ports: ReadonlyArray<ContainerPort>): string =>
  ports.length === 0
    ? "internal"
    : ports.map((port) =>
        port.publicPort === undefined
          ? `${port.privatePort}/${port.protocol ?? "tcp"}`
          : `${port.publicPort}->${port.privatePort}/${port.protocol ?? "tcp"}`
      ).join(", ")

export const renderDatabaseList = (databases: ReadonlyArray<DetectedDatabase>): string => {
  if (databases.length === 0) {
    return "No supported database containers are running."
  }
  const lines = databases.map((database, index) =>
    `${index + 1}. ${database.name}  ${displayDatabaseKind(database.kind)}  ${database.image}  [${renderPorts(database.ports)}]`
  )
  return ["Running database containers:", ...lines].join("\n")
}

export const renderSchemas = (schemas: ReadonlyArray<SchemaInfo>): string =>
  schemas.length === 0
    ? "No schemas/databases found."
    : schemas.map((schema, index) => `${index + 1}. ${schema.name}${schema.kind === undefined ? "" : ` (${schema.kind})`}`).join("\n")

export const renderTables = (tables: ReadonlyArray<TableInfo>): string =>
  tables.length === 0
    ? "No tables/keys/collections found."
    : tables.map((table, index) => {
        const location = table.schema === undefined || table.schema === "" ? "" : `${table.schema}.`
        const count = table.rowCount === undefined || table.rowCount < 0 ? "" : ` (${table.rowCount} rows)`
        return `${index + 1}. ${location}${table.name}${table.kind === undefined ? "" : ` [${table.kind}]`}${count}`
      }).join("\n")

export const renderColumns = (columns: ReadonlyArray<ColumnInfo>): string =>
  columns.length === 0
    ? "No columns found (the table may be empty or schemaless)."
    : columns.map((column, index) => {
        const nullable = column.nullable === undefined ? "" : column.nullable ? " nullable" : " required"
        const defaultValue = column.defaultValue === undefined || column.defaultValue === "" ? "" : ` default=${column.defaultValue}`
        return `${index + 1}. ${column.name}  ${column.dataType ?? "unknown"}${nullable}${defaultValue}`
      }).join("\n")
