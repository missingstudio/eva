// A small queue with a few deliberate smells, vendored as review input.
export class JobQueue {
  private jobs: any[] = []
  private running = false

  push(job: any) {
    this.jobs.push(job)
    this.drain()
  }

  async drain() {
    if (this.running) return
    this.running = true
    while (this.jobs.length > 0) {
      const job = this.jobs.shift()
      try {
        await job.run()
      } catch (e) {
        console.log("job failed: " + e)
      }
    }
    this.running = false
  }

  size() {
    return this.jobs.length
  }

  clear() {
    this.jobs = []
    this.running = false
  }
}
