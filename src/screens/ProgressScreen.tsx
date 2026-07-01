// ProgressScreen (P-01…P-03) — the stats hub, assembled against progress/Progress.html.
// Three sub-tabs: Route (CEFR tier ladder by mastered words), Inventory (FSRS word
// distribution), Pace (projection + daily pace + all-time). Reads the state layer via
// `useProgressData()`. The bottom nav is the persistent tab layout, not this screen.
import type { TFunction } from 'i18next';
import { useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';

import { useTranslation } from '@/i18n';
import { useProgressData } from '@/query/hooks';
import { TIERS } from '@/theme/tiers';
import { EmptyState, IconBook, IconChart, IconCheck, IconFire, IconLock, IconMountain, RawText, Screen } from '@/ui';

type SubTab = 'route' | 'inventory' | 'pace';

// CEFR tier bounds by cumulative mastered words (from the tier registry's wordCount).
const THRESH = TIERS.map((t) => t.wordCount); // [100,500,1000,2000,3000]
const tierMin = (i: number) => (i === 0 ? 0 : THRESH[i - 1]);
const tierMax = (i: number) => THRESH[i];
function currentTierIdx(mastered: number): number {
  const i = THRESH.findIndex((max) => mastered < max);
  return i === -1 ? TIERS.length - 1 : i;
}

export function ProgressScreen() {
  const { t } = useTranslation();
  const [tab, setTab] = useState<SubTab>('route');
  const data = useProgressData();

  return (
    <Screen edges={['top']}>
      <View style={styles.header}>
        <RawText style={styles.title}>{t('progress.title')}</RawText>
        <View style={styles.subTabs}>
          {(['route', 'inventory', 'pace'] as SubTab[]).map((id) => {
            const on = tab === id;
            return (
              <Pressable key={id} onPress={() => setTab(id)} style={styles.subTab} accessibilityRole="tab" accessibilityState={{ selected: on }}>
                <RawText style={[styles.subTabText, on && styles.subTabTextOn]}>{t(`progress.tab${id[0].toUpperCase()}${id.slice(1)}`)}</RawText>
                <View style={[styles.subTabUnderline, on && styles.subTabUnderlineOn]} />
              </Pressable>
            );
          })}
        </View>
      </View>
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        {tab === 'route' && <RouteTab data={data} t={t} />}
        {tab === 'inventory' && <InventoryTab data={data} t={t} />}
        {tab === 'pace' && <PaceTab data={data} t={t} />}
      </ScrollView>
    </Screen>
  );
}

type TabProps = { data: ReturnType<typeof useProgressData>; t: TFunction };

// ── Route ────────────────────────────────────────────────────────────────────
function RouteTab({ data, t }: TabProps) {
  const { theme } = useUnistyles();
  const mastered = data.totalMastered;

  if (data.totalSaved === 0) {
    return <EmptyState style={styles.empty} illustration={<IconMountain size={52} color={theme.color.evergreen} />} title={t('progress.emptyRouteTitle')} body={t('progress.emptyRouteBody')} />;
  }

  const cur = currentTierIdx(mastered);
  const curTier = TIERS[cur];
  const next = TIERS[cur + 1];
  const min = tierMin(cur);
  const max = tierMax(cur);
  const pctInTier = Math.max(0, Math.min(100, Math.round(((mastered - min) / (max - min)) * 100)));

  return (
    <View style={styles.pad}>
      {/* You are here */}
      <View style={[styles.hereCard, { backgroundColor: curTier.bg, borderColor: curTier.border }]}>
        <RawText style={styles.hereLabel}>{t('progress.youAreHere')}</RawText>
        <RawText style={styles.hereTier}>{t(`tier.${curTier.id}.name`)}</RawText>
        <RawText style={[styles.hereCefr, { color: curTier.color }]}>{t('progress.cefr', { level: curTier.cefr })}</RawText>
        <View style={styles.hereRow}>
          <RawText style={styles.hereMastered}>
            {mastered}
            <RawText style={styles.hereMasteredSuffix}> {t('progress.mastered')}</RawText>
          </RawText>
          <RawText style={styles.hereToNext}>{next ? t('progress.toNext', { count: max - mastered, tier: t(`tier.${next.id}.name`) }) : t('progress.summitReached')}</RawText>
        </View>
        <View style={styles.hereTrack}>
          <View style={[styles.hereFill, { width: `${pctInTier}%`, backgroundColor: curTier.color }]} />
        </View>
        <RawText style={styles.herePct}>{t('progress.pctThrough', { pct: pctInTier, tier: t(`tier.${curTier.id}.name`) })}</RawText>
      </View>

      {/* Full route ladder (Summit at top) */}
      <RawText style={styles.sectionTitle}>{t('progress.fullRoute')}</RawText>
      <RawText style={styles.sectionSub}>{t('progress.fullRouteSub')}</RawText>
      <View style={styles.ladder}>
        {[...TIERS].reverse().map((tier) => {
            const origIdx = TIERS.findIndex((x) => x.id === tier.id);
            const completed = origIdx < cur;
            const current = origIdx === cur;
            const locked = origIdx > cur;
            const node = completed
              ? { backgroundColor: theme.palette.green[500], borderColor: theme.palette.green[400] }
              : current
                ? { backgroundColor: theme.color.brand, borderColor: theme.color.brand }
                : { backgroundColor: theme.color.surfaceCard, borderColor: theme.palette.slate[200] };
            return (
              <View key={tier.id} style={[styles.ladderRow, locked && { opacity: 0.5 }]}>
                <View style={[styles.node, node]}>
                  {completed && <IconCheck size={14} color="#fff" />}
                  {current && <RawText style={styles.nodeNum}>{origIdx + 1}</RawText>}
                  {locked && <IconLock size={12} color={theme.palette.slate[300]} />}
                </View>
                <View style={styles.ladderBody}>
                  <View style={styles.ladderTitleRow}>
                    <RawText style={[styles.ladderTier, { color: completed ? theme.palette.green[800] : current ? theme.color.textStrong : theme.palette.slate[400] }]}>
                      {t(`tier.${tier.id}.name`)}
                    </RawText>
                    {current && <RawText style={styles.badgeCurrent}>{t('progress.current')}</RawText>}
                    {completed && <RawText style={styles.badgeDone}>{t('progress.done')}</RawText>}
                  </View>
                  <RawText style={[styles.ladderCefr, { color: current ? theme.color.brand : completed ? theme.palette.green[600] : theme.palette.slate[300] }]}>
                    {t('progress.cefr', { level: tier.cefr })}
                  </RawText>
                  <RawText style={styles.ladderStatus}>
                    {locked && t('progress.unlockAt', { count: tierMin(origIdx) })}
                    {completed && t('progress.masteredPlus', { count: tierMin(origIdx) })}
                    {current && t('progress.ofWords', { count: mastered, max: tierMax(origIdx) })}
                  </RawText>
                </View>
              </View>
            );
          })}
      </View>
    </View>
  );
}

// ── Inventory ─────────────────────────────────────────────────────────────────
function InventoryTab({ data, t }: TabProps) {
  const { theme } = useUnistyles();
  if (data.totalSaved === 0) {
    return <EmptyState style={styles.empty} illustration={<IconBook size={48} color={theme.color.textMuted} />} title={t('progress.emptyInventoryTitle')} body={t('progress.emptyInventoryBody')} />;
  }
  const total = data.tierCounts.reduce((a, b) => a + b, 0);
  return (
    <View style={styles.pad}>
      <RawText style={styles.sectionTitle}>{t('progress.wordsByTier')}</RawText>
      <RawText style={styles.sectionSub}>{t('progress.wordsByTierSub', { count: total })}</RawText>
      {/* Segmented bar */}
      <View style={styles.invBar}>
        {TIERS.map((tier, i) => {
          const c = data.tierCounts[i] ?? 0;
          if (c === 0) return null;
          return <View key={tier.id} style={{ flex: c, backgroundColor: tier.color }} />;
        })}
      </View>
      {/* Per-tier rows */}
      <View style={styles.invRows}>
        {TIERS.map((tier, i) => {
          const c = data.tierCounts[i] ?? 0;
          const pct = total > 0 ? Math.round((c / total) * 100) : 0;
          return (
            <View key={tier.id} style={styles.invRow}>
              <View style={[styles.invDot, { backgroundColor: tier.color }]} />
              <View style={styles.invRowBody}>
                <View style={styles.invRowTop}>
                  <RawText style={styles.invTier}>{t(`tier.${tier.id}.name`)}</RawText>
                  <RawText style={styles.invCount}>{c}</RawText>
                </View>
                <View style={styles.invRowBottom}>
                  <RawText style={styles.invRange}>{t(`tier.${tier.id}.stabilityRange`)}</RawText>
                  <RawText style={styles.invPct}>{pct}%</RawText>
                </View>
              </View>
            </View>
          );
        })}
      </View>
    </View>
  );
}

// ── Pace ──────────────────────────────────────────────────────────────────────
function PaceTab({ data, t }: TabProps) {
  const { theme } = useUnistyles();
  if (data.totalSaved === 0 || data.sessionsTotal === 0) {
    return <EmptyState style={styles.empty} illustration={<IconChart size={48} color={theme.color.brand} />} title={t('progress.emptyPaceTitle')} body={t('progress.emptyPaceBody')} />;
  }
  const cur = currentTierIdx(data.totalMastered);
  const next = TIERS[cur + 1];
  const masteryRate = data.daysActive > 0 ? data.totalMastered / data.daysActive : 0;
  const canProject = data.totalMastered > 0 && data.daysActive > 0 && next != null;
  const wordsToNext = next ? tierMax(cur) - data.totalMastered : 0;
  const daysToNext = canProject && masteryRate > 0 ? Math.ceil(wordsToNext / masteryRate) : null;
  const reviewsPerDay = data.daysActive > 0 ? Math.round((data.sessionsTotal * 20) / data.daysActive) : 0;

  const tiles: { label: string; value: string; Icon: typeof IconBook; color: string }[] = [
    { label: t('progress.sessions'), value: String(data.sessionsTotal), Icon: IconChart, color: theme.palette.blue[500] },
    { label: t('progress.avgAccuracy'), value: data.avgAccuracy > 0 ? `${data.avgAccuracy}%` : '—', Icon: IconCheck, color: theme.palette.green[600] },
    { label: t('progress.bestStreak'), value: data.bestStreak > 0 ? `${data.bestStreak}d` : '—', Icon: IconFire, color: theme.palette.amber[500] },
    { label: t('progress.totalSaved'), value: String(data.totalSaved), Icon: IconBook, color: theme.palette.blue[400] },
  ];

  return (
    <View style={styles.pad}>
      <RawText style={styles.sectionTitle}>{t('progress.atThisPace')}</RawText>
      {canProject && daysToNext != null && next != null ? (
        <View style={styles.projCard}>
          <View style={styles.projHead}>
            <IconMountain size={26} color={theme.color.brand} />
            <View>
              <RawText style={styles.projSmall}>{t('progress.estDaysToReach')}</RawText>
              <RawText style={styles.projTier}>
                {t(`tier.${next.id}.name`)} <RawText style={styles.projCefr}>{next.cefr}</RawText>
              </RawText>
            </View>
          </View>
          <View style={styles.projBig}>
            <RawText style={styles.projDays}>{daysToNext}</RawText>
            <RawText style={styles.projDaysLabel}>{t('progress.days')}</RawText>
          </View>
          <RawText style={styles.projDetail}>{t('progress.paceDetail', { words: wordsToNext, rate: masteryRate.toFixed(1) })}</RawText>
        </View>
      ) : (
        <View style={styles.projLocked}>
          <IconMountain size={32} color={theme.palette.slate[300]} />
          <RawText style={styles.projLockedTitle}>{t('progress.projectionLocked')}</RawText>
          <RawText style={styles.projLockedBody}>{t('progress.projectionLockedBody')}</RawText>
        </View>
      )}

      <View style={styles.divider} />

      <RawText style={styles.sectionTitle}>{t('progress.dailyPace')}</RawText>
      <View style={styles.paceRow}>
        <View style={[styles.paceTile, { backgroundColor: theme.palette.blue[50], borderColor: theme.palette.blue[200] }]}>
          <RawText style={styles.paceValue}>{`~${reviewsPerDay}`}</RawText>
          <RawText style={[styles.paceLabel, { color: theme.palette.blue[700] }]}>{t('progress.reviewsPerDay')}</RawText>
        </View>
        <View style={[styles.paceTile, { backgroundColor: theme.palette.amber[50], borderColor: theme.palette.amber[200] }]}>
          <RawText style={styles.paceValue}>{canProject ? `~${masteryRate.toFixed(1)}` : '—'}</RawText>
          <RawText style={[styles.paceLabel, { color: theme.palette.amber[800] }]}>{t('progress.masteredPerDay')}</RawText>
        </View>
      </View>

      <View style={styles.divider} />

      <RawText style={styles.sectionTitle}>{t('progress.allTime')}</RawText>
      <View style={styles.tileGrid}>
        {tiles.map(({ label, value, Icon, color }) => (
          <View key={label} style={styles.allTile}>
            <Icon size={20} color={color} />
            <RawText style={styles.allValue}>{value}</RawText>
            <RawText style={styles.allLabel}>{label}</RawText>
          </View>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create((theme) => {
  const { color, palette, fonts, radius } = theme;
  return {
    header: { paddingHorizontal: 16, paddingTop: 4, borderBottomWidth: theme.borderWidth.thin, borderBottomColor: color.border },
    title: { fontFamily: fonts.sans.extra, fontSize: 22, letterSpacing: -0.3, color: color.textStrong, marginBottom: 8 },
    subTabs: { flexDirection: 'row' },
    subTab: { flex: 1, alignItems: 'center', paddingBottom: 0 },
    subTabText: { fontFamily: fonts.sans.regular, fontSize: 14, color: color.textMuted, paddingVertical: 9 },
    subTabTextOn: { fontFamily: fonts.sans.semibold, color: color.brand },
    subTabUnderline: { height: 2, alignSelf: 'stretch', backgroundColor: 'transparent' },
    subTabUnderlineOn: { backgroundColor: color.brand },

    scroll: { paddingBottom: 20 },
    pad: { paddingHorizontal: 16, paddingTop: 16, paddingBottom: 8 },
    empty: { paddingTop: 56 },
    sectionTitle: { fontFamily: fonts.sans.bold, fontSize: 15, color: color.textStrong },
    sectionSub: { fontFamily: fonts.sans.regular, fontSize: 12, color: color.textMuted, marginTop: 2, marginBottom: 14 },
    divider: { height: 1, backgroundColor: color.border, marginVertical: 20 },

    // Route — you are here
    hereCard: { borderWidth: 1.5, borderRadius: radius.lg, paddingHorizontal: 18, paddingVertical: 16, marginBottom: 24 },
    hereLabel: { fontFamily: fonts.sans.bold, fontSize: 11, letterSpacing: 0.6, textTransform: 'uppercase', color: color.textMuted, marginBottom: 4 },
    hereTier: { fontFamily: fonts.serif.bold, fontSize: 20, color: color.textStrong },
    hereCefr: { fontFamily: fonts.sans.semibold, fontSize: 12, marginTop: 3 },
    hereRow: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', marginTop: 12, marginBottom: 8 },
    hereMastered: { fontFamily: fonts.serif.bold, fontSize: 28, color: color.textStrong },
    hereMasteredSuffix: { fontFamily: fonts.sans.medium, fontSize: 14, color: color.textMuted },
    hereToNext: { fontFamily: fonts.sans.regular, fontSize: 12, color: color.textMuted, paddingBottom: 3 },
    hereTrack: { height: 8, backgroundColor: 'rgba(255,255,255,0.6)', borderRadius: 6, overflow: 'hidden' },
    hereFill: { height: '100%', borderRadius: 6 },
    herePct: { fontFamily: fonts.sans.regular, fontSize: 11, color: color.textMuted, marginTop: 5, textAlign: 'right' },

    // Route — ladder
    ladder: { marginTop: 12, gap: 20 },
    ladderRow: { flexDirection: 'row', gap: 14, alignItems: 'flex-start' },
    node: { width: 38, height: 38, borderRadius: 19, borderWidth: 3, alignItems: 'center', justifyContent: 'center' },
    nodeNum: { fontFamily: fonts.sans.bold, fontSize: 12, color: '#fff' },
    ladderBody: { flex: 1, paddingTop: 4 },
    ladderTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 3 },
    ladderTier: { fontFamily: fonts.sans.semibold, fontSize: 15 },
    badgeCurrent: { fontFamily: fonts.sans.bold, fontSize: 10, letterSpacing: 0.5, textTransform: 'uppercase', color: color.brand, backgroundColor: palette.blue[100], paddingVertical: 2, paddingHorizontal: 7, borderRadius: 4, overflow: 'hidden' },
    badgeDone: { fontFamily: fonts.sans.bold, fontSize: 10, letterSpacing: 0.5, textTransform: 'uppercase', color: palette.green[700], backgroundColor: palette.green[100], paddingVertical: 2, paddingHorizontal: 7, borderRadius: 4, overflow: 'hidden' },
    ladderCefr: { fontFamily: fonts.sans.semibold, fontSize: 11, letterSpacing: 0.4, marginBottom: 4 },
    ladderStatus: { fontFamily: fonts.sans.regular, fontSize: 12, color: color.textMuted },

    // Inventory
    invBar: { flexDirection: 'row', height: 20, borderRadius: 10, overflow: 'hidden', backgroundColor: palette.slate[100], marginBottom: 20 },
    invRows: { gap: 10 },
    invRow: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: color.surfaceCard, borderWidth: theme.borderWidth.thin, borderColor: color.border, borderRadius: radius.md, paddingVertical: 12, paddingHorizontal: 14 },
    invDot: { width: 10, height: 10, borderRadius: 3 },
    invRowBody: { flex: 1 },
    invRowTop: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' },
    invTier: { fontFamily: fonts.sans.bold, fontSize: 13, color: color.textStrong },
    invCount: { fontFamily: fonts.mono.bold, fontSize: 17, color: color.textStrong },
    invRowBottom: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 2 },
    invRange: { fontFamily: fonts.sans.regular, fontSize: 11, color: color.textMuted },
    invPct: { fontFamily: fonts.sans.regular, fontSize: 11, color: color.textMuted },

    // Pace
    projCard: { backgroundColor: palette.blue[50], borderWidth: 1.5, borderColor: palette.blue[200], borderRadius: radius.lg, padding: 18, marginTop: 12 },
    projHead: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 14 },
    projSmall: { fontFamily: fonts.sans.regular, fontSize: 12, color: color.textMuted, marginBottom: 2 },
    projTier: { fontFamily: fonts.sans.bold, fontSize: 16, color: color.textStrong },
    projCefr: { fontFamily: fonts.sans.semibold, fontSize: 13, color: color.brand },
    projBig: { flexDirection: 'row', alignItems: 'flex-end', gap: 8, marginBottom: 6 },
    projDays: { fontFamily: fonts.serif.bold, fontSize: 44, color: color.brand },
    projDaysLabel: { fontFamily: fonts.sans.semibold, fontSize: 18, color: color.textMuted, paddingBottom: 5 },
    projDetail: { fontFamily: fonts.sans.regular, fontSize: 12, color: color.textMuted },
    projLocked: { backgroundColor: palette.slate[50], borderWidth: theme.borderWidth.base, borderColor: palette.slate[200], borderStyle: 'dashed', borderRadius: radius.lg, padding: 20, alignItems: 'center', marginTop: 12 },
    projLockedTitle: { fontFamily: fonts.sans.semibold, fontSize: 14, color: color.textMuted, marginTop: 10, marginBottom: 6 },
    projLockedBody: { fontFamily: fonts.sans.regular, fontSize: 12, lineHeight: 18, color: color.textMuted, textAlign: 'center', maxWidth: 220 },
    paceRow: { flexDirection: 'row', gap: 10, marginTop: 12 },
    paceTile: { flex: 1, borderWidth: theme.borderWidth.thin, borderRadius: radius.md, paddingHorizontal: 14, paddingVertical: 14 },
    paceValue: { fontFamily: fonts.serif.bold, fontSize: 26, color: color.textStrong, marginBottom: 6 },
    paceLabel: { fontFamily: fonts.sans.semibold, fontSize: 11, letterSpacing: 0.5, textTransform: 'uppercase' },
    tileGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 12 },
    allTile: { width: '47.5%', flexGrow: 1, backgroundColor: color.surfaceCard, borderWidth: theme.borderWidth.thin, borderColor: color.border, borderRadius: radius.lg, paddingHorizontal: 14, paddingVertical: 14 },
    allValue: { fontFamily: fonts.serif.bold, fontSize: 26, color: color.textStrong, marginTop: 8, marginBottom: 4 },
    allLabel: { fontFamily: fonts.sans.semibold, fontSize: 11, letterSpacing: 0.5, textTransform: 'uppercase', color: color.textMuted },
  };
});
