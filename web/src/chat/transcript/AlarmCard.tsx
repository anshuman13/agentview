import { Icon } from '../../ui/Icon';
import { Row } from '../../ui/Row';
import { alarmCard, type ToolResult, type ToolUse } from './steps';

// An alarm the agent set on the phone: the time, its label and whether the phone took it.
export function AlarmCard({ use, result, running }: { use: ToolUse; result?: ToolResult; running: boolean }) {
  const { time, label, status, tone } = alarmCard(use, result, running);
  return (
    <div className="ui-group tr-act">
      <Row plain leading={<Icon name="bell" />} title="Alarm" lines={1} />
      <div className="tr-alarm-body">
        <div className="tr-alarm-time">{time}</div>
        {label && <div className="tr-alarm-label" title={label}>{label}</div>}
        <div className={`tr-alarm-status ${tone}`}>{tone === 'pending' && <Icon name="loading" small spin />}{status}</div>
      </div>
    </div>
  );
}
