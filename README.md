# ReScheduler

ReScheduler fills a residency year. Residents, rotations, blocks, and rules are all data, so the same app works for any program.

The schedule is a mixed-integer program. [HiGHS 1.15](https://highs.dev/) solves it with branch and cut, compiled to WebAssembly and run beside the page. If the clock runs out before a feasible grid exists, that is the answer.

## The assignment

For each resident $r$, block $b$, and rotation $t$ they may take, the model has a binary variable

$$
x_{r,b,t} \in \\{0,1\\}.
$$

One means that person is on that rotation for that block. Every resident has exactly one rotation in every block:

$$
\sum_t x_{r,b,t} = 1.
$$

A rotation that covers several blocks is a start, and the weeks it covers are tied to that start. Locked weeks, a locked resident, and approved leave are fixed before the search. A block where someone has no eligible rotation is reported up front, and the solver is not asked to drop the lock or the leave.

Staffing is the headcount on a rotation:

$$
m_{t,b} \le \sum_r x_{r,b,t} \le M_{t,b}.
$$

A training requirement $q$ is a credit total. If rotation $t$ is worth $c_{q,t}$ toward it, resident $r$ has to cover what they still owe:

$$
\sum_{b,t} c_{q,t} x_{r,b,t} \ge Q_{r,q}.
$$

Rules at priority 0 stay in these inequalities. A rule can bend only when you marked it relaxable.

## Choosing among feasible schedules

Feasible grids are not ranked by one blended score. The goals run in order. Each is a linear function of the $x$ variables. When a goal finishes, its value is written in as a constraint, and the next goal is optimized inside what remains.

The balanced schedule uses this order.

**Vacation.** A pending request has a weight. The first choice is 1000, and each later choice steps down by how many requests that resident made. An alternate week is worth half the request. The solver maximizes

$$
\sum_{r,b} v_{r,b} x_{r,b,\mathrm{vacation}}.
$$

Approved leave is already fixed, so it does not add to $v$. With no pending requests, this stage is empty.

**Fairness.** Inside a class and track, ICU, nights, wards, and holiday blocks each get their own load. For a category, let $u_r$ be the blocks resident $r$ is given, plus the same kind of work from earlier in training, minus blocks a requirement already demands of them. Holiday work is a block on a holiday that is not vacation. The solver minimizes $z$ subject to $z \ge u_r$ for everyone in the group, which pulls down whoever would otherwise carry the most.

**Career.** A rotation that matches an interest or an elective preference scores up to 1000, with the same rank weights as vacation. The total of those points is maximized. A score entered on the rotation replaces the one inferred from its name.

**Stability.** Assignments that already match the grid are kept when that does not give back an earlier goal. Weeks that are already past weigh more.

**Spacing.** If two adjacent blocks are both high intensity, that pair counts. The number of such pairs is minimized last.

Generation also searches a few other schedules, each of which puts vacation, fairness, career, or stability ahead of the rest. Preview one, then apply it. Applying is what writes the grid.

## When every rule cannot hold

If the hard model has no solution, rules you allowed to bend pick up slack. A staffing minimum becomes

$$
\sum_r x_{r,b,t} + s_{t,b} \ge m_{t,b}, \qquad s_{t,b} \in \mathbb{Z}_{\ge 0},
$$

and a requirement gets the same kind of slack on the credit still owed. Slack stops at the limit you set for that rule. The solver minimizes the higher-priority slack first, then the total slack, then how many residents a requirement slack touches. Vacation, fairness, and the other goals run after that, on the loosened model.

Locks, protected leave, eligibility, and priority 0 never take slack. If those contradict each other, there is no schedule to offer.

The grid is checked again, apart from the solver, against the same rules and whatever slack was used. A grid that fails that check stays off the calendar.
