import SectionTabs from '../components/SectionTabs';

// The archive holds everything kept: the timeline of days, the calendar with its years in review, and the projects
// that gather entries over months.

const TABS = [
  { href: '/archive', label: '时间线' },
  { href: '/archive/calendar', label: '日历', match: /^\/archive\/\d{4}$/ },
  { href: '/projects', label: '项目' }
];

export default function ArchiveTabs() {
  return <SectionTabs label="档案" tabs={TABS} />;
}
