export const FAILED_JOB_MS = 24 * 3600_000;

type JobLike = { id: string; profile: string; deleted: number; enabled: number | null; next_run_at: number | null };
type RunLike = { profile: string; job_id: string | null; deleted: number; status: string | null; started_at: number | null; finished_at: number | null };

// A job's runs, newest first.
export const runsOf = <R extends RunLike>(runs: R[], j: Pick<JobLike, 'id' | 'profile'>) => runs.filter((r) => !r.deleted && r.profile === j.profile && r.job_id === j.id).sort((a, b) => (b.started_at ?? 0) - (a.started_at ?? 0));

// A job whose next run is due and that has no run going.
export const queued = (j: JobLike, runs: RunLike[], now: number) => j.next_run_at != null && j.next_run_at <= now && !runsOf(runs, j).some((r) => r.status === 'running');

// The enabled jobs whose newest run ended in error in the last 24 h and that are not queued, each with that run.
export function failedJobs<J extends JobLike, R extends RunLike>(jobs: J[], runs: R[], now: number): { job: J; run: R }[] {
  return jobs.flatMap((job) => {
    const run = runsOf(runs, job)[0];
    const failed = !job.deleted && !!job.enabled && run?.status === 'error' && run.finished_at != null && now - run.finished_at <= FAILED_JOB_MS && !queued(job, runs, now);
    return failed ? [{ job, run }] : [];
  });
}
