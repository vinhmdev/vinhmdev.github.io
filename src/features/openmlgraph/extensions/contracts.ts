/**
 * Declarative Plugin SDK & Community Auto-Discovery [FR-5.3].
 *
 * Provides strongly typed factory functions (`defineMathFunction`,
 * `defineOptimizer`, `defineLesson`) and auto-registers plugins via
 * `import.meta.glob('./plugins/*.ts', { eager: true })` so contributors can add a new
 * activation function, optimizer, or lesson in a single standalone file.
 */
import type {
  LessonTemplate,
  MathFunctionPlugin,
  OptimizerPlugin,
} from '../types/plugin';

interface GlobalPluginRegistry {
  mathFns: Map<string, MathFunctionPlugin>;
  optimizers: Map<string, OptimizerPlugin>;
  lessons: Map<string, LessonTemplate>;
}

function getRegistry(): GlobalPluginRegistry {
  const g = globalThis as unknown as { __openmlPluginRegistry?: GlobalPluginRegistry };
  if (!g.__openmlPluginRegistry) {
    g.__openmlPluginRegistry = {
      mathFns: new Map<string, MathFunctionPlugin>(),
      optimizers: new Map<string, OptimizerPlugin>(),
      lessons: new Map<string, LessonTemplate>(),
    };
  }
  return g.__openmlPluginRegistry;
}

export function defineMathFunction(plugin: MathFunctionPlugin): MathFunctionPlugin {
  getRegistry().mathFns.set(plugin.name.toLowerCase(), plugin);
  return plugin;
}

export function defineOptimizer(plugin: OptimizerPlugin): OptimizerPlugin {
  getRegistry().optimizers.set(plugin.id, plugin);
  return plugin;
}

export function defineLesson(lesson: LessonTemplate): LessonTemplate {
  getRegistry().lessons.set(lesson.id, lesson);
  return lesson;
}

export function getRegisteredMathFunction(name: string): MathFunctionPlugin | undefined {
  return getRegistry().mathFns.get(name.toLowerCase());
}

export function getRegisteredMathFunctions(): MathFunctionPlugin[] {
  return Array.from(getRegistry().mathFns.values());
}

export function getRegisteredOptimizers(): OptimizerPlugin[] {
  return Array.from(getRegistry().optimizers.values());
}

export function getRegisteredLessons(): LessonTemplate[] {
  return Array.from(getRegistry().lessons.values());
}

// Auto-discover any standalone plugin files under ./plugins/*.ts
const discoveredPluginModules = import.meta.glob('./plugins/*.ts', { eager: true });
void discoveredPluginModules;
