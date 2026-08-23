export type DatabaseKind = "postgres" | "mysql" | "redis" | "mongo"

export const databaseKinds: ReadonlyArray<DatabaseKind> = [
  "postgres",
  "mysql",
  "redis",
  "mongo"
]

export interface ContainerPort {
  readonly privatePort: string
  readonly publicPort?: string
  readonly protocol?: string
}

export interface DetectedDatabase {
  readonly id: string
  readonly name: string
  readonly image: string
  readonly kind: DatabaseKind
  readonly status: string
  readonly ports: ReadonlyArray<ContainerPort>
  readonly labels: Readonly<Record<string, string>>
  readonly environment: Readonly<Record<string, string>>
}

export interface QueryRequest {
  readonly text: string
  readonly limit?: number
}

export interface QueryResult {
  readonly columns: ReadonlyArray<string>
  readonly rows: ReadonlyArray<ReadonlyArray<string | null>>
  readonly rowCount: number
  readonly truncated: boolean
  readonly note?: string
}

export interface SchemaInfo {
  readonly name: string
  readonly kind?: string
}

export interface TableInfo {
  readonly schema?: string
  readonly name: string
  readonly kind?: string
  readonly rowCount?: number
}

export interface ColumnInfo {
  readonly name: string
  readonly dataType?: string
  readonly nullable?: boolean
  readonly defaultValue?: string
}

export type ManagedDatabaseStatus = "running" | "paused" | "stopped" | "created" | "unknown"

export interface DatabaseConnection {
  readonly host: string
  readonly port: number
  readonly url: string
  readonly database: string
  readonly username: string
  readonly password: string | null
}

export interface DatabaseImageStatus {
  readonly kind: DatabaseKind
  readonly image: string
  readonly version: string
  readonly installed: boolean
}

export interface ManagedDatabase {
  readonly id: string
  readonly name: string
  readonly alias: string
  readonly image: string
  readonly kind: DatabaseKind
  readonly status: ManagedDatabaseStatus
  readonly ports: ReadonlyArray<ContainerPort>
  readonly labels: Readonly<Record<string, string>>
  readonly environment: Readonly<Record<string, string>>
  readonly connection: DatabaseConnection | null
}

export interface CreateDatabaseRequest {
  readonly kind: DatabaseKind
  readonly alias?: string
}

export interface DatabaseLogs {
  readonly name: string
  readonly text: string
  readonly truncated: boolean
}
