// /kitchen-sink — the RN analog of the design system's Foundation.html gallery.
// Every UI-kit component renders here so the kit can be eyeballed on iOS + Android
// against the prototypes. Grows as P2 adds components.
import { type ReactNode, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';

import { TIERS } from '@/theme/tiers';
import {
  Button,
  Card,
  DeckRow,
  EmptyState,
  Input,
  MasteryCard,
  ProgressDots,
  QuizCardBack,
  type QuizCardData,
  QuizCardFront,
  RatingButtons,
  Screen,
  Sheet,
  TabBar,
  type TabId,
  Text,
  type TextVariant,
  TierBadge,
  Toggle,
  Tooltip,
  TranslationCard,
  type TranslationResult,
  WordRow,
} from '@/ui';

const QUIZ_CARD: QuizCardData = {
  frontWord: 'montaña',
  frontSub: '/mon.ˈta.ɲa/',
  frontPrompt: 'What is the translation?',
  backWord: 'mountain',
  backPhonetic: '/ˈmaʊntən/',
  backPos: 'noun',
  backExample: 'The mountain is beautiful in winter.',
};

const SAMPLE_RESULT: TranslationResult = {
  sourceText: 'montaña',
  phonetic: '/mon.ˈta.ɲa/',
  pos: 'noun',
  translations: [
    {
      id: 't1',
      word: 'mountain',
      pos: 'noun',
      example: { source: 'La montaña es hermosa.', target: 'The mountain is beautiful.' },
      details: [
        { label: 'gender', value: 'feminine' },
        { label: 'plural', value: 'montañas' },
      ],
    },
    { id: 't2', word: 'mount', pos: 'noun', example: { source: 'Subimos el monte.', target: 'We climbed the mount.' } },
    { id: 't3', word: 'highland', pos: 'noun' },
  ],
};

const TYPE_SPECIMENS: { variant: TextVariant; sample: string }[] = [
  { variant: 'display', sample: 'Headword' },
  { variant: 'title', sample: 'Screen title' },
  { variant: 'heading', sample: 'Section heading' },
  { variant: 'subheading', sample: 'Card subheading' },
  { variant: 'body', sample: 'Body copy — the default interface text size and rhythm.' },
  { variant: 'bodyStrong', sample: 'Body strong — emphasized inline.' },
  { variant: 'caption', sample: 'Caption — secondary supporting text.' },
  { variant: 'footnote', sample: 'Footnote — the smallest supporting text.' },
  { variant: 'label', sample: 'Eyebrow label' },
  { variant: 'reading', sample: 'Reading — long-form passages set in Spectral for comfort.' },
  { variant: 'mono', sample: '/ˈlɛk.sɪ.kæmp/ · 1,234' },
];

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <View style={styles.section}>
      <Text variant="label" color="textFaint">
        {title}
      </Text>
      <View style={styles.sectionBody}>{children}</View>
    </View>
  );
}

export default function KitchenSink() {
  const [notif, setNotif] = useState(true);
  const [offline, setOffline] = useState(false);
  const [lang, setLang] = useState('');
  const [step, setStep] = useState(2);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [tab, setTab] = useState<TabId>('home');
  const [curIdx, setCurIdx] = useState(0);
  const [saved, setSaved] = useState<Set<string>>(new Set());
  const [justSaved, setJustSaved] = useState<string | null>(null);
  const [flipped, setFlipped] = useState(false);
  return (
    <Screen>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <Text variant="title">Kitchen Sink</Text>
        <Text variant="caption">Lexicamp UI kit — P2 primitives</Text>

        <Section title="Typography">
          <View style={styles.typeList}>
            {TYPE_SPECIMENS.map((s) => (
              <Text key={s.variant} variant={s.variant}>
                {s.sample}
              </Text>
            ))}
          </View>
        </Section>

        <Section title="Buttons">
          <View style={styles.stack}>
            <Button title="Primary action" variant="primary" />
            <Button title="Secondary / Cancel" variant="secondary" />
            <Button title="Delete account" variant="destructive" />
            <Button title="Ghost link" variant="ghost" />
            <View style={styles.row}>
              <Button title="Get started" variant="pill" />
              <Button title="Disabled" variant="pill" disabled />
            </View>
            <Button title="Primary disabled" variant="primary" disabled />
          </View>
        </Section>

        <Section title="Cards">
          <View style={styles.stack}>
            <Card>
              <Text variant="subheading">Default card</Text>
              <Text variant="caption">surface-card · 1px border · radius-lg</Text>
            </Card>
            <Card elevated>
              <Text variant="subheading">Elevated card</Text>
              <Text variant="caption">adds shadow-md</Text>
            </Card>
            <Card interactive onPress={() => {}}>
              <Text variant="subheading">Interactive card</Text>
              <Text variant="caption">press → brand border + lift</Text>
            </Card>
          </View>
        </Section>

        <Section title="Tooltip (press to reveal)">
          <View style={styles.row}>
            <Tooltip title="Summit · C2" content="Stability 30+ days. Mastered — retained for the long haul; fluency vocabulary.">
              <View style={styles.infoChip}>
                <Text variant="caption">What is Summit? ⓘ</Text>
              </View>
            </Tooltip>
            <Tooltip content="A short contextual help popup. Tap anywhere to dismiss.">
              <View style={styles.infoChip}>
                <Text variant="caption">Help ⓘ</Text>
              </View>
            </Tooltip>
          </View>
        </Section>

        <Section title="Tier badges">
          <View style={styles.stack}>
            <Text variant="footnote" color="textFaint">
              chip (md / sm)
            </Text>
            <View style={styles.row}>
              {TIERS.map((t) => (
                <TierBadge key={t.id} tier={t} variant="chip" size="md" />
              ))}
              {TIERS.map((t) => (
                <TierBadge key={`${t.id}-sm`} tier={t} variant="chip" size="sm" />
              ))}
            </View>
            <Text variant="footnote" color="textFaint">
              pill (md / sm)
            </Text>
            <View style={styles.row}>
              {TIERS.map((t) => (
                <TierBadge key={t.id} tier={t} variant="pill" size="md" />
              ))}
            </View>
            <View style={styles.row}>
              {TIERS.map((t) => (
                <TierBadge key={`${t.id}-sm`} tier={t} variant="pill" size="sm" />
              ))}
            </View>
            <Text variant="footnote" color="textFaint">
              badge
            </Text>
            <View style={styles.row}>
              {TIERS.map((t) => (
                <TierBadge key={`${t.id}-badge`} tier={t} variant="badge" px={64} />
              ))}
            </View>
          </View>
        </Section>

        <Section title="Toggle">
          <View style={styles.stack}>
            <View style={styles.toggleRow}>
              <Text variant="body">Daily reminders</Text>
              <Toggle value={notif} onValueChange={setNotif} />
            </View>
            <View style={styles.toggleRow}>
              <Text variant="body">Offline mode</Text>
              <Toggle value={offline} onValueChange={setOffline} />
            </View>
            <View style={styles.toggleRow}>
              <Text variant="body" color="textFaint">
                Disabled
              </Text>
              <Toggle value disabled />
            </View>
          </View>
        </Section>

        <Section title="Inputs">
          <View style={styles.stack}>
            <Input
              label="Target language"
              placeholder="e.g. Spanish"
              value={lang}
              onChangeText={setLang}
              autoCapitalize="words"
            />
            <Input label="Native language" placeholder="e.g. English" />
            <Input label="With error" placeholder="Enter your email" error="This field is required" />
          </View>
        </Section>

        <Section title="Progress dots">
          <View style={styles.stack}>
            <View style={styles.toggleRow}>
              <ProgressDots count={6} index={step} />
              <Button
                title="Next"
                variant="pill"
                onPress={() => setStep((s) => (s + 1) % 6)}
              />
            </View>
          </View>
        </Section>

        <Section title="Empty state">
          <Card padding={0}>
            <EmptyState
              illustration={<View style={styles.illusPlaceholder} />}
              title="No words yet"
              body="Words you save while reading will land here, ready for review."
              cta="Add your first word"
              onCta={() => {}}
              secondary="Learn how it works"
              onSecondary={() => {}}
              networkNote="No connection — saved words sync when you're back online."
            />
          </Card>
        </Section>

        <Section title="Word rows (swipe left for actions)">
          <Card padding={0}>
            <WordRow
              word={{ native: 'mountain', target: 'montaña', added: '2d', stability: 1 }}
              isPremium
              onPress={() => {}}
            />
            <WordRow
              word={{ native: 'to remember', target: 'recordar', added: '5d', stability: 9 }}
              onPress={() => {}}
            />
            <WordRow
              word={{ native: 'fluency', target: 'fluidez', added: '3w', stability: 40 }}
              isPremium
              onPress={() => {}}
            />
          </Card>
        </Section>

        <Section title="Mastery card">
          <View style={styles.stack}>
            <MasteryCard tierCounts={[10, 20, 12, 5, 13]} wordsSaved={60} />
            <MasteryCard isEmpty />
          </View>
        </Section>

        <Section title="Deck rows (swipe left for actions)">
          <Card padding={0}>
            <DeckRow deck={{ name: 'Travel Spanish', created: '1w' }} wordCount={42} onPress={() => {}} />
            <DeckRow deck={{ name: 'Cooking verbs', created: '3d' }} wordCount={1} onPress={() => {}} />
          </Card>
        </Section>

        <Section title="Quiz card (recognition · tap to reveal)">
          {flipped ? (
            <QuizCardBack tier="hc" card={QUIZ_CARD} />
          ) : (
            <QuizCardFront tier="hc" card={QUIZ_CARD} mode="recognition" onReveal={() => setFlipped(true)} />
          )}
          <Button
            title={flipped ? 'Flip to front' : 'Flip to back'}
            variant="ghost"
            onPress={() => setFlipped((f) => !f)}
          />
        </Section>

        <Section title="Quiz card (recall · char input)">
          <QuizCardFront tier="sr" card={QUIZ_CARD} mode="recall" autoFocus={false} onReveal={() => {}} />
        </Section>

        <Section title="Translation card">
          <TranslationCard
            result={SAMPLE_RESULT}
            currentIdx={curIdx}
            onSetCurrent={setCurIdx}
            savedIds={saved}
            justSavedId={justSaved}
            onSave={(i) => {
              const id = SAMPLE_RESULT.translations[i].id;
              setSaved((s) => new Set(s).add(id));
              setJustSaved(id);
              setTimeout(() => setJustSaved(null), 1500);
            }}
            onDelete={(i) => {
              const id = SAMPLE_RESULT.translations[i].id;
              setSaved((s) => {
                const n = new Set(s);
                n.delete(id);
                return n;
              });
            }}
          />
        </Section>

        <Section title="Rating buttons">
          <RatingButtons onRate={() => {}} />
        </Section>

        <Section title="Sheet">
          <Button title="Open sheet" variant="secondary" onPress={() => setSheetOpen(true)} />
        </Section>

        <Section title="Tab bar">
          <View style={styles.tabBarFrame}>
            <TabBar
              activeTab={tab}
              onTabChange={setTab}
              sheetOpen={sheetOpen}
              onFabPress={() => setSheetOpen((v) => !v)}
            />
          </View>
        </Section>
      </ScrollView>

      <Sheet visible={sheetOpen} onClose={() => setSheetOpen(false)} title="Add a word">
        <Text variant="body">
          This is a bottom sheet rendered with @gorhom/bottom-sheet — swipe down or tap the scrim
          to dismiss.
        </Text>
        <Input label="Word" placeholder="Type a word in Spanish…" />
        <Button title="Save word" variant="primary" onPress={() => setSheetOpen(false)} />
      </Sheet>
    </Screen>
  );
}

const styles = StyleSheet.create((theme) => ({
  content: { padding: theme.space[5], gap: theme.space[2], paddingBottom: theme.space[12] },
  section: { marginTop: theme.space[6], gap: theme.space[3] },
  sectionBody: { gap: theme.space[3] },
  typeList: { gap: theme.space[3] },
  stack: { gap: theme.space[3] },
  row: { flexDirection: 'row', gap: theme.space[3], alignItems: 'center', flexWrap: 'wrap' },
  toggleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  infoChip: {
    borderWidth: theme.borderWidth.thin,
    borderColor: theme.color.border,
    borderRadius: theme.radius.pill,
    backgroundColor: theme.color.surfaceCard,
    paddingVertical: 6,
    paddingHorizontal: 12,
  },
  illusPlaceholder: {
    width: 72,
    height: 72,
    borderRadius: theme.radius.xl,
    backgroundColor: theme.color.surfaceSunken,
  },
  // Frame so the raised FAB (which overflows the bar's top) has room in the gallery.
  tabBarFrame: {
    paddingTop: 36,
    borderWidth: theme.borderWidth.thin,
    borderColor: theme.color.border,
    borderRadius: theme.radius.lg,
    overflow: 'hidden',
    backgroundColor: theme.color.surfaceSunken,
  },
}));
