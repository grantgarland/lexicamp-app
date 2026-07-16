// HowItWorksList — the three-concept FSRS educator accordion (spaced repetition /
// study queue / usage tips), shared between the Home educator card and the Settings
// "How Lexicamp works" sheet (17 §H3). Each item independently expands to its
// explanation + graphic; opening one closes the others.
import { useState } from 'react';
import { Pressable, View } from 'react-native';
import Animated, { FadeIn, FadeOut } from 'react-native-reanimated';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';

import { useTranslation } from '@/i18n';

import { CardSorter, DailyPractice, ForgettingCurve } from './illustrations';
import { IconChevronDown, IconChevronUp } from './icons';
import { RawText } from './Text';

export function HowItWorksList() {
  const { theme } = useUnistyles();
  const { t } = useTranslation();
  // Accordion: only one section open at a time (opening one closes the others).
  const [openSection, setOpenSection] = useState<number | null>(null);
  const toggleSection = (i: number) => setOpenSection((cur) => (cur === i ? null : i));
  const sections = [
    { title: t('home.edu.s1Title'), body: t('home.edu.s1Body'), graphic: <ForgettingCurve /> },
    { title: t('home.edu.s2Title'), body: t('home.edu.s2Body'), graphic: <CardSorter /> },
    { title: t('home.edu.s3Title'), body: t('home.edu.s3Body'), graphic: <DailyPractice /> },
  ];
  return (
    <View>
      {sections.map((s, i) => {
        const isOpen = openSection === i;
        return (
          <View key={s.title} style={styles.item}>
            <Pressable
              onPress={() => toggleSection(i)}
              accessibilityRole="button"
              accessibilityState={{ expanded: isOpen }}
              accessibilityLabel={s.title}
              style={({ pressed }) => [styles.itemHeader, pressed && { opacity: 0.6 }]}
            >
              <RawText style={styles.itemTitle}>{s.title}</RawText>
              {isOpen ? (
                <IconChevronUp size={14} color={theme.color.textMuted} />
              ) : (
                <IconChevronDown size={14} color={theme.color.textMuted} />
              )}
            </Pressable>
            {isOpen && (
              <Animated.View entering={FadeIn.duration(160)} exiting={FadeOut.duration(120)}>
                <RawText style={styles.itemBody}>{s.body}</RawText>
                <View style={styles.itemGraphic}>{s.graphic}</View>
              </Animated.View>
            )}
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create((theme) => {
  const { color, fonts } = theme;
  return {
    item: { borderTopWidth: theme.borderWidth.thin, borderTopColor: color.divider },
    itemHeader: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 11 },
    itemTitle: { flex: 1, fontFamily: fonts.sans.semibold, fontSize: 13, color: color.textStrong },
    itemBody: { fontFamily: fonts.sans.regular, fontSize: 12.5, lineHeight: 18, color: color.textMuted },
    itemGraphic: { marginTop: 12, paddingBottom: 14 },
  };
});
