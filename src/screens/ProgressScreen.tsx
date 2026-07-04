// ProgressScreen (P-01…P-03) — the stats hub, assembled against progress/Progress.html.
// Three sub-tabs: Route (CEFR tier ladder by mastered words), Inventory (FSRS word
// distribution), Pace (projection + daily pace + all-time). Reads the state layer via
// `useProgressData()`. The bottom nav is the persistent tab layout, not this screen.
import type { TFunction } from 'i18next';
import { useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';

import type { WordListItem } from '@/data/DataSource';
import { MOUNTAIN_TIERS, mountainTier } from '@/domain/derive';
import { useTranslation } from '@/i18n';
import { dueLabel } from '@/lib/relativeTime';
import { useProgressData, useWords } from '@/query/hooks';
import { getTierByStability, TIERS } from '@/theme/tiers';
import { EmptyState, IconBook, IconChart, IconCheck, IconFire, IconInfo, IconLock, IconMountain, IconStar, RawText, Screen, SegmentedTabs, Sheet } from '@/ui';

type SubTab = 'route' | 'inventory' | 'pace';
type InfoKey = 'cefr' | 'fsrs';

// A saved word's review "health" from its next-due date: overdue → needs review,
// due within 2 days → approaching, else healthy. Drives the tier-drawer row dot.
const DAY_MS = 24 * 60 * 60 * 1000;
function wordHealth(dueAt: Date): 'due' | 'soon' | 'ok' {
  const ms = dueAt.getTime() - Date.now();
  if (ms <= 0) return 'due';
  if (ms <= 2 * DAY_MS) return 'soon';
  return 'ok';
}

// ── Mountain-tier thresholds — SOURCE OF TRUTH is domain/derive.ts MOUNTAIN_TIERS
// (mastered-word thresholds → CEFR) + tiers.ts TIERS (registry names/colors). The
// user's position is mountainTier(masteredCount); a tier's window is [masteredMin,
// nextTier.masteredMin). Registry visuals are looked up by the shared tier id.
const masteredMinAt = (i: number) => MOUNTAIN_TIERS[i].masteredMin;
const masteredMaxAt = (i: number) => (i + 1 < MOUNTAIN_TIERS.length ? MOUNTAIN_TIERS[i + 1].masteredMin : Number.POSITIVE_INFINITY);
const tierRegistry = (i: number) => TIERS[i]; // MOUNTAIN_TIERS and TIERS share id order

export function ProgressScreen() {
  const { t } = useTranslation();
  const [tab, setTab] = useState<SubTab>('route');
  const [info, setInfo] = useState<InfoKey | null>(null);
  const [tierDrawer, setTierDrawer] = useState<number | null>(null);
  const data = useProgressData();
  const { words } = useWords();

  return (
    <Screen edges={['top']}>
      <View style={styles.header}>
        <RawText style={styles.title}>{t('progress.title')}</RawText>
        <SegmentedTabs
          active={tab}
          onChange={(id) => setTab(id as SubTab)}
          tabs={[
            { id: 'route', label: t('progress.tabRoute') },
            { id: 'inventory', label: t('progress.tabInventory') },
            { id: 'pace', label: t('progress.tabPace') },
          ]}
        />
      </View>
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        {tab === 'route' && <RouteTab data={data} t={t} onInfo={setInfo} />}
        {tab === 'inventory' && <InventoryTab data={data} t={t} onInfo={setInfo} onOpenTier={setTierDrawer} />}
        {tab === 'pace' && <PaceTab data={data} t={t} />}
      </ScrollView>

      <InfoSheet infoKey={info} t={t} onClose={() => setInfo(null)} />
      <TierWordsSheet tierIdx={tierDrawer} words={words} t={t} onClose={() => setTierDrawer(null)} />
    </Screen>
  );
}

type TabProps = {
  data: ReturnType<typeof useProgressData>;
  t: TFunction;
  onInfo?: (key: InfoKey) => void;
  onOpenTier?: (tierIdx: number) => void;
};

// ── Route ────────────────────────────────────────────────────────────────────
function RouteTab({ data, t, onInfo }: TabProps) {
  const { theme } = useUnistyles();
  const saved = data.totalSaved;

  if (saved === 0) {
    return <EmptyState style={styles.empty} illustration={<IconMountain size={52} color={theme.color.evergreen} />} title={t('progress.emptyRouteTitle')} body={t('progress.emptyRouteBody')} />;
  }

  // SOURCE OF TRUTH: mountain rank derives from mastered-word count (03 / derive.ts),
  // not saved words or the FSRS distribution.
  const mastered = data.totalMastered;
  const curTierId = mountainTier(mastered).id;
  const cur = MOUNTAIN_TIERS.findIndex((x) => x.id === curTierId);
  const curReg = tierRegistry(cur);
  const next = MOUNTAIN_TIERS[cur + 1];
  const min = masteredMinAt(cur);
  const max = masteredMaxAt(cur);
  const pctInTier = Number.isFinite(max) ? Math.max(0, Math.min(100, Math.round(((mastered - min) / (max - min)) * 100))) : 100;

  return (
    <View style={styles.pad}>
      {/* You are here */}
      <View style={[styles.hereCard, { backgroundColor: curReg.bg, borderColor: curReg.border }]}>
        <View style={styles.hereTop}>
          <View style={styles.hereTopText}>
            <RawText style={styles.hereLabel}>{t('progress.youAreHere')}</RawText>
            <RawText style={styles.hereTier}>{t(`tier.${curReg.id}.name`)}</RawText>
            <RawText style={[styles.hereCefr, { color: curReg.color }]}>{t('progress.cefr', { level: curReg.cefr })}</RawText>
          </View>
          <Pressable onPress={() => onInfo?.('cefr')} accessibilityRole="button" accessibilityLabel={t('progress.aboutCefr')} hitSlop={8} style={({ pressed }) => [styles.hereInfo, { borderColor: curReg.border }, pressed && { opacity: 0.6 }]}>
            <IconInfo size={13} color={curReg.color} />
          </Pressable>
        </View>
        <View style={styles.hereRow}>
          <RawText style={styles.hereMastered}>
            {mastered.toLocaleString()}
            <RawText style={styles.hereMasteredSuffix}> {t('progress.wordsSuffix')}</RawText>
          </RawText>
          <RawText style={styles.hereToNext}>{next ? t('progress.toNext', { count: Math.max(0, max - mastered), tier: t(`tier.${next.id}.name`) }) : t('progress.summitReached')}</RawText>
        </View>
        <View style={styles.hereTrack}>
          <View style={[styles.hereFill, { width: `${pctInTier}%`, backgroundColor: curReg.color }]} />
        </View>
        <RawText style={styles.herePct}>{t('progress.pctThrough', { pct: pctInTier, tier: t(`tier.${curReg.id}.name`) })}</RawText>

        {/* 0-mastered hint — the climb hasn't registered a mastered word yet */}
        {mastered === 0 && (
          <View style={[styles.hereHint, { borderColor: curReg.border }]}>
            <RawText style={styles.hereHintText}>{t('progress.masteredZeroHint')}</RawText>
          </View>
        )}
      </View>

      {/* Full route ladder (Summit at top) */}
      <RawText style={styles.sectionTitle}>{t('progress.fullRoute')}</RawText>
      <RawText style={styles.sectionSub}>{t('progress.fullRouteSub')}</RawText>
      <View style={styles.ladder}>
        {/* Connecting route line behind the nodes */}
        <View style={styles.ladderLine} />
        {[...MOUNTAIN_TIERS].reverse().map((mt) => {
            const origIdx = MOUNTAIN_TIERS.findIndex((x) => x.id === mt.id);
            const tier = tierRegistry(origIdx);
            const completed = origIdx < cur;
            const current = origIdx === cur;
            const locked = origIdx > cur;
            const finiteMax = Number.isFinite(masteredMaxAt(origIdx));
            const rowPct = current && finiteMax ? Math.max(0, Math.min(100, Math.round(((mastered - masteredMinAt(origIdx)) / (masteredMaxAt(origIdx) - masteredMinAt(origIdx))) * 100))) : 0;
            const node = completed
              ? { backgroundColor: theme.palette.green[500], borderColor: theme.palette.green[400] }
              : current
                ? { backgroundColor: theme.color.brand, borderColor: theme.color.brand }
                : { backgroundColor: theme.color.surfaceCard, borderColor: theme.palette.slate[200] };
            return (
              <View key={tier.id} style={styles.ladderRow}>
                {/* Node stays fully opaque so the route line never bleeds through a locked tier;
                    only the text body is dimmed for locked rows. */}
                <View style={[styles.node, node, current && styles.nodeCurrent, locked && styles.nodeLocked]}>
                  {completed && <IconCheck size={14} color="#fff" />}
                  {current && <RawText style={styles.nodeNum}>{origIdx + 1}</RawText>}
                  {locked && <IconLock size={12} color={theme.palette.slate[300]} />}
                </View>
                <View style={[styles.ladderBody, locked && { opacity: 0.5 }]}>
                  <View style={styles.ladderTitleRow}>
                    <RawText style={[styles.ladderTier, { color: completed ? theme.palette.green[800] : current ? theme.color.textStrong : theme.palette.slate[400] }]}>
                      {t(`tier.${tier.id}.name`)}
                    </RawText>
                    {tier.id === 'summit' && <IconStar size={13} color={theme.palette.amber[400]} />}
                    {current && <RawText style={styles.badgeCurrent}>{t('progress.current')}</RawText>}
                    {completed && <RawText style={styles.badgeDone}>{t('progress.done')}</RawText>}
                  </View>
                  <RawText style={[styles.ladderCefr, { color: current ? theme.color.brand : completed ? theme.palette.green[600] : theme.palette.slate[300] }]}>
                    {t('progress.cefr', { level: tier.cefr })}
                  </RawText>
                  <RawText style={styles.ladderStatus}>
                    {locked && t('progress.unlockAt', { count: masteredMinAt(origIdx).toLocaleString() })}
                    {completed && t('progress.masteredPlus', { count: masteredMinAt(origIdx).toLocaleString() })}
                    {current && (finiteMax ? t('progress.ofWords', { count: mastered.toLocaleString(), max: masteredMaxAt(origIdx).toLocaleString() }) : t('progress.atSummitWords', { count: mastered.toLocaleString() }))}
                  </RawText>
                  {current && finiteMax && (
                    <View style={styles.ladderProgress}>
                      <View style={styles.ladderProgressRow}>
                        <RawText style={styles.ladderProgressLabel}>{t('progress.wordsToNext', { count: Math.max(0, masteredMaxAt(origIdx) - mastered) })}</RawText>
                        <RawText style={styles.ladderProgressPct}>{rowPct}%</RawText>
                      </View>
                      <View style={styles.ladderTrack}>
                        <View style={[styles.ladderFill, { width: `${rowPct}%` }]} />
                      </View>
                    </View>
                  )}
                </View>
              </View>
            );
          })}
      </View>
    </View>
  );
}

// ── Inventory ─────────────────────────────────────────────────────────────────
function InventoryTab({ data, t, onInfo, onOpenTier }: TabProps) {
  const { theme } = useUnistyles();
  if (data.totalSaved === 0) {
    return <EmptyState style={styles.empty} illustration={<IconBook size={48} color={theme.color.textMuted} />} title={t('progress.emptyInventoryTitle')} body={t('progress.emptyInventoryBody')} />;
  }
  const total = data.tierCounts.reduce((a, b) => a + b, 0);
  return (
    <View style={styles.pad}>
      <View style={styles.invHead}>
        <View style={styles.invHeadText}>
          <RawText style={styles.sectionTitle}>{t('progress.wordsByTier')}</RawText>
          <RawText style={styles.sectionSub}>{t('progress.wordsByTierSub', { count: total })}</RawText>
        </View>
        <Pressable onPress={() => onInfo?.('fsrs')} accessibilityRole="button" accessibilityLabel={t('progress.aboutFsrs')} hitSlop={8} style={({ pressed }) => [styles.headInfo, pressed && { opacity: 0.6 }]}>
          <IconInfo size={14} color={theme.color.textMuted} />
        </Pressable>
      </View>
      {/* Segmented bar */}
      <View style={styles.invBar}>
        {TIERS.map((tier, i) => {
          const c = data.tierCounts[i] ?? 0;
          if (c === 0) return null;
          return <View key={tier.id} style={{ flex: c, backgroundColor: tier.color }} />;
        })}
      </View>
      {/* Per-tier rows — pressable when the tier holds words */}
      <View style={styles.invRows}>
        {TIERS.map((tier, i) => {
          const c = data.tierCounts[i] ?? 0;
          const pct = total > 0 ? Math.round((c / total) * 100) : 0;
          const empty = c === 0;
          return (
            <Pressable
              key={tier.id}
              disabled={empty}
              onPress={() => onOpenTier?.(i)}
              accessibilityRole={empty ? undefined : 'button'}
              accessibilityLabel={empty ? undefined : t('progress.viewTierWords', { tier: t(`tier.${tier.id}.name`) })}
              style={({ pressed }) => [styles.invRow, empty && styles.invRowEmpty, pressed && !empty && { opacity: 0.7 }]}
            >
              <View style={[styles.invDot, { backgroundColor: tier.color }]} />
              <View style={styles.invRowBody}>
                <View style={styles.invRowTop}>
                  <RawText style={styles.invTier}>{t(`tier.${tier.id}.name`)}</RawText>
                  <RawText style={styles.invCount}>{c}</RawText>
                </View>
                <View style={styles.invRowBottom}>
                  <RawText style={styles.invRange} numberOfLines={1}>{t(`tier.${tier.id}.shortDesc`)} · {t(`tier.${tier.id}.stabilityRange`)}</RawText>
                  <RawText style={styles.invPct}>{pct}%</RawText>
                </View>
              </View>
            </Pressable>
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
  // SOURCE OF TRUTH: projection is driven by mastered-word pace vs MOUNTAIN_TIERS.
  const mastered = data.totalMastered;
  const curId = mountainTier(mastered).id;
  const cur = MOUNTAIN_TIERS.findIndex((x) => x.id === curId);
  const next = MOUNTAIN_TIERS[cur + 1];
  const masteryRate = data.daysActive > 0 ? mastered / data.daysActive : 0;
  const canProject = mastered > 0 && data.daysActive > 0 && next != null;
  const wordsToNext = canProject ? Math.max(0, masteredMaxAt(cur) - mastered) : 0;
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
                {t(`tier.${next.id}.name`)} <RawText style={styles.projCefr}>{t('progress.cefr', { level: next.cefr })}</RawText>
              </RawText>
            </View>
          </View>
          <View style={styles.projBig}>
            <RawText style={styles.projDays}>{daysToNext}</RawText>
            <RawText style={styles.projDaysLabel}>{t('progress.days')}</RawText>
          </View>
          <RawText style={styles.projDetail}>{t('progress.paceDetail', { words: wordsToNext, rate: masteryRate.toFixed(1) })}</RawText>
          <View style={styles.projTrack}>
            <View style={[styles.projFill, { width: `${Math.max(0, Math.min(100, Math.round(((mastered - masteredMinAt(cur)) / (masteredMaxAt(cur) - masteredMinAt(cur))) * 100)))}%` }]} />
          </View>
          <View style={styles.projScaleRow}>
            <RawText style={styles.projScale}>{t('progress.paceNow', { count: mastered.toLocaleString() })}</RawText>
            <RawText style={styles.projScale}>{next != null ? `${t(`tier.${next.id}.name`)} · ${masteredMaxAt(cur).toLocaleString()}` : ''}</RawText>
          </View>
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

// ── Info sheets (CEFR ladder / FSRS stability) ────────────────────────────────
function InfoSheet({ infoKey, t, onClose }: { infoKey: InfoKey | null; t: TFunction; onClose: () => void }) {
  const { theme } = useUnistyles();
  const isCefr = infoKey === 'cefr';
  return (
    <Sheet visible={infoKey != null} onClose={onClose} title={t(isCefr ? 'progress.cefrTitle' : 'progress.fsrsTitle')}>
      <RawText style={styles.infoIntro}>{t(isCefr ? 'progress.cefrIntro' : 'progress.fsrsIntro')}</RawText>
      <View style={styles.infoList}>
        {TIERS.map((tier, i) => (
          <View key={tier.id} style={[styles.infoRow, { backgroundColor: isCefr ? tier.bg : theme.palette.slate[50], borderColor: isCefr ? tier.border : theme.color.border }]}>
            <View style={[isCefr ? styles.infoDotRound : styles.infoDotSquare, { backgroundColor: tier.color }]} />
            <View style={styles.infoRowBody}>
              <RawText style={styles.infoTier}>{t(`tier.${tier.id}.name`)}</RawText>
              <RawText style={styles.infoDesc}>{isCefr ? t('progress.masteredThreshold', { count: masteredMinAt(i).toLocaleString() }) : t(`tier.${tier.id}.desc`)}</RawText>
            </View>
            <RawText style={styles.infoMeta}>{isCefr ? t('progress.cefr', { level: MOUNTAIN_TIERS[i].cefr }) : t(`tier.${tier.id}.stabilityRange`)}</RawText>
          </View>
        ))}
      </View>
      <RawText style={styles.infoNote}>{t(isCefr ? 'progress.cefrNote' : 'progress.fsrsNote')}</RawText>
    </Sheet>
  );
}

// ── Tier word drawer (P3) — lists the saved words at one stability tier ───────────
function TierWordsSheet({ tierIdx, words, t, onClose }: { tierIdx: number | null; words: WordListItem[]; t: TFunction; onClose: () => void }) {
  const { theme } = useUnistyles();
  const tier = tierIdx != null ? TIERS[tierIdx] : null;
  const rows = tier != null ? words.filter((w) => getTierByStability(w.stability).id === tier.id) : [];
  const healthColor: Record<'due' | 'soon' | 'ok', string> = {
    due: theme.color.danger,
    soon: theme.palette.amber[500],
    ok: theme.palette.green[500],
  };
  return (
    <Sheet visible={tierIdx != null} onClose={onClose} title={tier != null ? t(`tier.${tier.id}.name`) : ''}>
      {tier != null && (
        <RawText style={styles.drawerSub}>{t('progress.tierWordsSub', { count: rows.length, range: t(`tier.${tier.id}.stabilityRange`) })}</RawText>
      )}
      <ScrollView style={styles.drawerScroll} showsVerticalScrollIndicator={false}>
        {rows.map((w) => {
          const health = wordHealth(w.dueAt);
          return (
            <View key={w.id} style={styles.drawerRow}>
              <View style={[styles.drawerHealth, { backgroundColor: healthColor[health] }]} />
              <View style={styles.drawerRowBody}>
                <RawText style={styles.drawerWord}>{w.native}</RawText>
                <RawText style={styles.drawerTarget}>{w.target}</RawText>
              </View>
              <View style={styles.drawerRight}>
                <RawText style={[styles.drawerDue, { color: healthColor[health] }]}>{dueLabel(w.dueAt, t)}</RawText>
                <RawText style={styles.drawerReps}>{t('progress.reviewsCount', { count: w.reps })}</RawText>
              </View>
            </View>
          );
        })}
      </ScrollView>
    </Sheet>
  );
}

const styles = StyleSheet.create((theme) => {
  const { color, palette, fonts, radius } = theme;
  return {
    header: { backgroundColor: color.surfaceCard, borderBottomWidth: theme.borderWidth.thin, borderBottomColor: color.border, paddingHorizontal: 16, paddingTop: 6 },
    title: { fontFamily: fonts.sans.extra, fontSize: 22, letterSpacing: -0.3, color: color.textStrong, marginBottom: 8 },

    scroll: { paddingBottom: 20 },
    pad: { paddingHorizontal: 16, paddingTop: 16, paddingBottom: 8 },
    empty: { paddingTop: 56 },
    sectionTitle: { fontFamily: fonts.sans.bold, fontSize: 15, color: color.textStrong },
    sectionSub: { fontFamily: fonts.sans.regular, fontSize: 12, color: color.textMuted, marginTop: 2, marginBottom: 14 },
    divider: { height: 1, backgroundColor: color.border, marginVertical: 20 },

    // Route — you are here
    hereCard: { borderWidth: 1.5, borderRadius: radius.lg, paddingHorizontal: 18, paddingVertical: 16, marginBottom: 24 },
    hereTop: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between' },
    hereTopText: { flex: 1 },
    hereInfo: { width: 26, height: 26, borderRadius: 13, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.5)' },
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
    hereHint: { marginTop: 12, paddingVertical: 8, paddingHorizontal: 12, borderRadius: 8, borderWidth: theme.borderWidth.thin, backgroundColor: 'rgba(255,255,255,0.55)' },
    hereHintText: { fontFamily: fonts.sans.regular, fontSize: 12, lineHeight: 18, color: color.textMuted, textAlign: 'center' },

    // Route — ladder
    ladder: { marginTop: 12, gap: 20, position: 'relative' },
    ladderLine: { position: 'absolute', left: 18, top: 19, bottom: 19, width: 2, backgroundColor: palette.slate[200], borderRadius: 1 },
    ladderRow: { flexDirection: 'row', gap: 14, alignItems: 'flex-start' },
    node: { width: 38, height: 38, borderRadius: 19, borderWidth: 3, alignItems: 'center', justifyContent: 'center', zIndex: 1 },
    nodeCurrent: { boxShadow: `0 0 0 5px ${palette.blue[100]}` },
    // Opaque muted fill for locked nodes — hides the route line behind them without using
    // row opacity (which would let the line show through).
    nodeLocked: { backgroundColor: palette.slate[50], borderColor: palette.slate[200] },
    nodeNum: { fontFamily: fonts.sans.bold, fontSize: 12, color: '#fff' },
    ladderBody: { flex: 1, paddingTop: 4 },
    ladderTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 3 },
    ladderTier: { fontFamily: fonts.sans.semibold, fontSize: 15 },
    ladderProgress: { marginTop: 8 },
    ladderProgressRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 5 },
    ladderProgressLabel: { fontFamily: fonts.sans.regular, fontSize: 11, color: color.textMuted },
    ladderProgressPct: { fontFamily: fonts.sans.bold, fontSize: 11, color: color.brand },
    ladderTrack: { height: 7, backgroundColor: palette.blue[100], borderRadius: 6, overflow: 'hidden' },
    ladderFill: { height: '100%', borderRadius: 6, backgroundColor: color.brand },
    badgeCurrent: { fontFamily: fonts.sans.bold, fontSize: 10, letterSpacing: 0.5, textTransform: 'uppercase', color: color.brand, backgroundColor: palette.blue[100], paddingVertical: 2, paddingHorizontal: 7, borderRadius: 4, overflow: 'hidden' },
    badgeDone: { fontFamily: fonts.sans.bold, fontSize: 10, letterSpacing: 0.5, textTransform: 'uppercase', color: palette.green[700], backgroundColor: palette.green[100], paddingVertical: 2, paddingHorizontal: 7, borderRadius: 4, overflow: 'hidden' },
    ladderCefr: { fontFamily: fonts.sans.semibold, fontSize: 11, letterSpacing: 0.4, marginBottom: 4 },
    ladderStatus: { fontFamily: fonts.sans.regular, fontSize: 12, color: color.textMuted },

    // Inventory
    invHead: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 14 },
    invHeadText: { flex: 1 },
    headInfo: { width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: palette.slate[100], marginLeft: 8 },
    invBar: { flexDirection: 'row', height: 20, borderRadius: 10, overflow: 'hidden', backgroundColor: palette.slate[100], marginBottom: 20 },
    invRows: { gap: 10 },
    invRow: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: color.surfaceCard, borderWidth: theme.borderWidth.thin, borderColor: color.border, borderRadius: radius.md, paddingVertical: 12, paddingHorizontal: 14 },
    invRowEmpty: { opacity: 0.5 },
    invDot: { width: 10, height: 10, borderRadius: 3 },
    invRowBody: { flex: 1 },
    invRowTop: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' },
    invTier: { fontFamily: fonts.sans.bold, fontSize: 13, color: color.textStrong },
    invCount: { fontFamily: fonts.mono.bold, fontSize: 17, color: color.textStrong },
    invRowBottom: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 2 },
    invRange: { flex: 1, fontFamily: fonts.sans.regular, fontSize: 11, color: color.textMuted },
    invPct: { fontFamily: fonts.sans.regular, fontSize: 11, color: color.textMuted, marginLeft: 8 },

    // Pace
    projCard: { backgroundColor: palette.blue[50], borderWidth: 1.5, borderColor: palette.blue[200], borderRadius: radius.lg, padding: 18, marginTop: 12 },
    projHead: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 14 },
    projSmall: { fontFamily: fonts.sans.regular, fontSize: 12, color: color.textMuted, marginBottom: 2 },
    projTier: { fontFamily: fonts.sans.bold, fontSize: 16, color: color.textStrong },
    projCefr: { fontFamily: fonts.sans.semibold, fontSize: 13, color: color.brand },
    projBig: { flexDirection: 'row', alignItems: 'flex-end', gap: 8, marginBottom: 6 },
    projDays: { fontFamily: fonts.serif.bold, fontSize: 44, color: color.brand },
    projDaysLabel: { fontFamily: fonts.sans.semibold, fontSize: 18, color: color.textMuted, paddingBottom: 5 },
    projDetail: { fontFamily: fonts.sans.regular, fontSize: 12, color: color.textMuted, marginBottom: 14 },
    projTrack: { height: 6, backgroundColor: palette.blue[100], borderRadius: 4, overflow: 'hidden' },
    projFill: { height: '100%', backgroundColor: color.brand, borderRadius: 4 },
    projScaleRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 4 },
    projScale: { fontFamily: fonts.sans.regular, fontSize: 10, color: color.textMuted },
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

    // Info sheets (CEFR / FSRS)
    infoIntro: { fontFamily: fonts.sans.regular, fontSize: 13, lineHeight: 20, color: color.textMuted, marginBottom: 14 },
    infoList: { gap: 8 },
    infoRow: { flexDirection: 'row', alignItems: 'center', gap: 12, borderWidth: theme.borderWidth.thin, borderRadius: radius.md, paddingVertical: 10, paddingHorizontal: 12 },
    infoDotRound: { width: 8, height: 8, borderRadius: 4 },
    infoDotSquare: { width: 10, height: 10, borderRadius: 3 },
    infoRowBody: { flex: 1 },
    infoTier: { fontFamily: fonts.sans.bold, fontSize: 13, color: color.textStrong },
    infoDesc: { fontFamily: fonts.sans.regular, fontSize: 11, lineHeight: 15, color: color.textMuted, marginTop: 1 },
    infoMeta: { fontFamily: fonts.mono.regular, fontSize: 11, color: color.textMuted, textAlign: 'right' },
    infoNote: { fontFamily: fonts.sans.regular, fontSize: 11, lineHeight: 16, fontStyle: 'italic', color: color.textMuted, marginTop: 12 },

    // Tier word drawer
    drawerSub: { fontFamily: fonts.sans.regular, fontSize: 12, color: color.textMuted, marginBottom: 12 },
    drawerScroll: { maxHeight: 360 },
    drawerRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10, borderBottomWidth: theme.borderWidth.thin, borderBottomColor: color.border },
    drawerHealth: { width: 8, height: 8, borderRadius: 4 },
    drawerRowBody: { flex: 1 },
    drawerWord: { fontFamily: fonts.sans.semibold, fontSize: 15, color: color.textStrong },
    drawerTarget: { fontFamily: fonts.sans.regular, fontSize: 12, color: color.textMuted, marginTop: 1 },
    drawerRight: { alignItems: 'flex-end' },
    drawerDue: { fontFamily: fonts.sans.semibold, fontSize: 12 },
    drawerReps: { fontFamily: fonts.sans.regular, fontSize: 11, color: color.textMuted, marginTop: 2 },
  };
});
