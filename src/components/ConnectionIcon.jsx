import {
  Server, HardDrive, Database, Cloud, Archive, Wifi, Cpu, Network,
  Globe, Home, Monitor, Laptop, Radio, Shield, Lock, Key,
  Folder, Box, Package, Terminal, Layers, Zap, Activity, Download, Upload,
} from 'lucide-react'

export const LUCIDE_ICONS = [
  { name: 'Server',    Icon: Server    },
  { name: 'HardDrive', Icon: HardDrive },
  { name: 'Database',  Icon: Database  },
  { name: 'Cloud',     Icon: Cloud     },
  { name: 'Archive',   Icon: Archive   },
  { name: 'Wifi',      Icon: Wifi      },
  { name: 'Cpu',       Icon: Cpu       },
  { name: 'Network',   Icon: Network   },
  { name: 'Globe',     Icon: Globe     },
  { name: 'Home',      Icon: Home      },
  { name: 'Monitor',   Icon: Monitor   },
  { name: 'Laptop',    Icon: Laptop    },
  { name: 'Radio',     Icon: Radio     },
  { name: 'Shield',    Icon: Shield    },
  { name: 'Lock',      Icon: Lock      },
  { name: 'Key',       Icon: Key       },
  { name: 'Folder',    Icon: Folder    },
  { name: 'Box',       Icon: Box       },
  { name: 'Package',   Icon: Package   },
  { name: 'Terminal',  Icon: Terminal  },
  { name: 'Layers',    Icon: Layers    },
  { name: 'Zap',       Icon: Zap       },
  { name: 'Activity',  Icon: Activity  },
  { name: 'Download',  Icon: Download  },
  { name: 'Upload',    Icon: Upload    },
]

const CDN = 'https://cdn.jsdelivr.net/gh/homarr-labs/dashboard-icons/svg'

export default function ConnectionIcon({ icon, size = 18 }) {
  if (!icon || icon.type === 'lucide') {
    const entry = LUCIDE_ICONS.find((e) => e.name === (icon?.value ?? 'Server'))
    const Icon  = entry?.Icon ?? Server
    return <Icon size={size} strokeWidth={1.75} />
  }

  if (icon.type === 'emoji') {
    return (
      <span style={{ fontSize: Math.round(size * 0.9), lineHeight: 1, display: 'block', textAlign: 'center' }}>
        {icon.value}
      </span>
    )
  }

  if (icon.type === 'service') {
    return (
      <img
        src={`${CDN}/${icon.value}.svg`}
        width={size}
        height={size}
        alt=""
        style={{ objectFit: 'contain', display: 'block' }}
        onError={(e) => { e.currentTarget.style.display = 'none' }}
      />
    )
  }

  return <Server size={size} strokeWidth={1.75} />
}
