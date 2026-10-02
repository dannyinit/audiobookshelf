import { DataTypes, Model, Op } from 'sequelize'

class Session extends Model {
  /** @type {string} */
  declare id
  /** @type {string} */
  declare ipAddress
  /** @type {string} */
  declare userAgent
  /** @type {Date} */
  declare createdAt
  /** @type {Date} */
  declare updatedAt
  /** @type {string} */
  declare userId
  /** @type {Date} */
  declare expiresAt
  /** @type {string} */
  declare lastRefreshToken
  /** @type {Date} */
  declare lastRefreshTokenExpiresAt
  /** @type {import('./User').User} */
  declare user

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
  static async cleanupExpiredSessions() {
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
  static init(sequelize) {
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
