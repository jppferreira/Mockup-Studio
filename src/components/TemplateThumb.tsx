import DeviceModelThumb from './DeviceModelThumb';
import type { CompositionTemplate } from '../lib/templates';
import type { MockupProject } from '../types';

function deviceIdsFromProject(project: MockupProject): string[] {
  const ids: string[] = [];
  for (const device of project.devices) {
    if (!ids.includes(device.deviceId)) ids.push(device.deviceId);
  }
  return ids.slice(0, 3);
}

function StaticDeviceShot({
  deviceIds,
  layout,
}: {
  deviceIds: string[];
  layout?: CompositionTemplate['preview'];
}) {
  const ids = deviceIds.length ? deviceIds : ['iphone_17_pro'];
  const count = Math.min(3, ids.length);
  return (
    <span
      className={`template-shot is-static count-${count}${layout ? ` layout-${layout}` : ''}`}
    >
      {ids.slice(0, 3).map((deviceId, index) => (
        <DeviceModelThumb key={`${deviceId}-${index}`} deviceId={deviceId} />
      ))}
    </span>
  );
}

export function ProjectThumb({ project }: { project: MockupProject; cacheKey?: string }) {
  return <StaticDeviceShot deviceIds={deviceIdsFromProject(project)} />;
}

export default function TemplateThumb({ template }: { template: CompositionTemplate }) {
  const deviceIds = template.devices.map((device) => device.deviceId);
  return <StaticDeviceShot deviceIds={deviceIds} layout={template.preview} />;
}
