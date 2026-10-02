import 'sequelize'

declare module 'sequelize' {
  interface Sequelize {
    /** Helper attached in Database.connect() to build polymorphic association accessor names */
    uppercaseFirst(str: string): string
  }
}
