import SocketAuthority = require('../SocketAuthority')
import Task = require('../objects/Task')

interface TaskString {
  text: string
  key: string
  subs?: string[]
}

class TaskManager {
  /** @type {Task[]} */
  tasks: Task[]

  constructor() {
    this.tasks = []
  }

  /**
   * Add task and emit socket task_started event
   *
   * @param {Task} task
   */
  addTask(task: Task) {
    this.tasks.push(task)
    SocketAuthority.emitter('task_started', task.toJSON())
  }

  /**
   * Remove task and emit task_finished event
   *
   * @param {Task} task
   */
  taskFinished(task: Task) {
    if (this.tasks.some((t) => t.id === task.id)) {
      this.tasks = this.tasks.filter((t) => t.id !== task.id)
      SocketAuthority.emitter('task_finished', task.toJSON())
    }
  }

  /**
   * Create new task and add
   *
   * @param {string} action
   * @param {TaskString} titleString
   * @param {TaskString|null} descriptionString
   * @param {boolean} showSuccess
   * @param {Object} [data]
   */
  createAndAddTask(action: string, titleString: TaskString, descriptionString: TaskString | null, showSuccess: boolean, data: Record<string, any> = {}) {
    const task = new Task()
    task.setData(action, titleString, descriptionString, showSuccess, data)
    this.addTask(task)
    return task
  }

  /**
   * Create new failed task and add
   *
   * @param {string} action
   * @param {TaskString} titleString
   * @param {TaskString|null} descriptionString
   * @param {TaskString} errorMessageString
   */
  createAndEmitFailedTask(action: string, titleString: TaskString, descriptionString: TaskString | null, errorMessageString: TaskString) {
    const task = new Task()
    task.setData(action, titleString, descriptionString, false)
    task.setFailed(errorMessageString)
    SocketAuthority.emitter('task_started', task.toJSON())
    return task
  }
}
export = new TaskManager()
