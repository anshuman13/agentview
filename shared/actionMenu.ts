// Which of a meeting action's menu items show for its status, on web and Android. Assign also needs the action's meeting. Delete shows for every status.
export function actionMenu(status: string): { notMine: boolean; assign: boolean; snooze: boolean } {
  const live = status === 'open' || status === 'suggested';
  return { notMine: live, assign: status === 'open', snooze: live };
}
