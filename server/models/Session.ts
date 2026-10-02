import { DataTypes, Model, Op } from 'sequelize'

class Session extends Model {
  /** @type {string} */
  declare id: string
  /** @type {string} */
  declare ipAddress: string
  /** @type {string} */
  declare userAgent: string
  /** @type {Date} */
  declare createdAt: Date
  /** @type {Date} */
  declare updatedAt: Date
  /** @type {string} */
  declare userId: string
  /** @type {Date} */
  declare expiresAt: Date
  /** @type {string} */
  declare lastRefreshToken: string
  /** @type {Date} */
  declare lastRefreshTokenExpiresAt: Date
  /** @type {import('./User').User} */
  declare user: import('./User').User

  constructor(values, options) {
    super(values, options)


    // Expanded properties

  }

  static async createSession(userId, ipAddress, userAgent, refreshToken, expiresAt) {
    const session = await Session.create({ userId, ipAddress, userAgent, refreshToken, expiresAt })
    return session
  }

  /**
   * Clean up expired sessions from the database
   * @returns {Promise<number>} Number of sessions deleted
   */
  static async cleanupExpiredSessions(): Promise<number> {
    const deletedCount = await Session.destroy({
      where: {
        expiresAt: {
          [Op.lt]: new Date()
        }
      }
    })
    return deletedCount
  }

  /**
   * Initialize model
   * @param {import('../Database').sequelize} sequelize
   */
  static init(sequelize: import('../Database').sequelize) {
    super.init(
      {
        id: {
          type: DataTypes.UUID,
          defaultValue: DataTypes.UUIDV4,
          primaryKey: true
        },
        ipAddress: DataTypes.STRING,
        userAgent: DataTypes.STRING,
        refreshToken: {
          type: DataTypes.STRING,
          allowNull: false
        },
        expiresAt: {
          type: DataTypes.DATE,
          allowNull: false
        },
        lastRefreshToken: {
          type: DataTypes.STRING,
          allowNull: true
        },
        lastRefreshTokenExpiresAt: {
          type: DataTypes.DATE,
          allowNull: true
        }
      },
      {
        sequelize,
        modelName: 'session'
      }
    )

    const { user } = sequelize.models
    user.hasMany(Session, {
      onDelete: 'CASCADE',
      foreignKey: {
        allowNull: false
      }
    })
    Session.belongsTo(user)
  }
}

export = Session
