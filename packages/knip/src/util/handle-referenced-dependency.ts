import type { ConfigurationChief, Workspace } from '../ConfigurationChief.js';
import type { DependencyDeputy } from '../DependencyDeputy.js';
import type { IssueCollector } from '../IssueCollector.js';
import { IGNORED_RUNTIME_DEPENDENCIES } from '../constants.js';
import { type Input, fromBinary, isBinary, isConfigPattern, isDependency } from './input.js';
import { getPackageNameFromSpecifier } from './modules.js';
import { dirname, isAbsolute, isInternal, join } from './path.js';
import { _resolveSync } from './resolve.js';

/**
 * Resolve internal file paths + collect issues
 *
 * Try not to use module resolver. This is slow. Use known workspaces and dependencies.
 * Eventually we might be able to work mostly from lockfile alone.
 */
export const getReferencedDependencyHandler =
  (
    collector: IssueCollector,
    deputy: DependencyDeputy,
    chief: ConfigurationChief,
    isGitIgnored: (s: string) => boolean
  ) =>
  (input: Input, workspace: Workspace) => {
    const { specifier, containingFilePath } = input;

    if (!containingFilePath || IGNORED_RUNTIME_DEPENDENCIES.has(specifier)) return;

    if (isBinary(input)) {
      const binaryName = fromBinary(input);
      const ws = (input.dir && chief.findWorkspaceByFilePath(`${input.dir}/`)) || workspace;
      const isHandled = deputy.maybeAddReferencedBinary(ws, binaryName);
      if (isHandled) return;
      collector.addIssue({
        type: 'binaries',
        filePath: containingFilePath,
        workspace: workspace.name,
        symbol: binaryName,
      });
      return;
    }

    const packageName = getPackageNameFromSpecifier(specifier);

    if (packageName) {
      // Attempt fast path first for external dependencies and internal workspaces
      const isWorkspace = chief.workspacesByPkgName.has(packageName);
      const specifierWorkspace = chief.findWorkspaceByFilePath(containingFilePath) ?? workspace;

      if (specifierWorkspace) {
        const isHandled = deputy.maybeAddReferencedExternalDependency(specifierWorkspace, packageName);

        if (isWorkspace || isDependency(input)) {
          if (!isHandled) {
            if ((deputy.isProduction && input.production) || !deputy.isProduction) {
              // Unlisted dependency
              collector.addIssue({
                type: 'unlisted',
                filePath: containingFilePath,
                workspace: specifierWorkspace.name,
                symbol: specifier,
              });
            }
            return;
          }

          // Return resolved path for refs to internal workspaces
          const ref = _resolveSync(specifier, dirname(containingFilePath));
          if (ref && !isGitIgnored(ref)) return ref;
        }

        if (isHandled) return;
      }
    }

    if (!isConfigPattern(input) && deputy.isProduction && !input.production) {
      return;
    }

    const baseDir = input.dir ?? dirname(containingFilePath);
    const filePath = isAbsolute(specifier) ? specifier : join(baseDir, specifier);
    const resolvedFilePath = _resolveSync(filePath, baseDir);

    if (resolvedFilePath && isInternal(resolvedFilePath)) {
      return isGitIgnored(resolvedFilePath) ? undefined : resolvedFilePath;
    }

    if (!isInternal(filePath)) {
      collector.addIssue({
        type: 'unlisted',
        filePath: containingFilePath,
        workspace: workspace.name,
        symbol: packageName ?? specifier,
      });
    } else if (!isConfigPattern(dependency) && !isGitIgnored(filePath)) {
      collector.addIssue({
        type: 'unresolved',
        filePath: containingFilePath,
        workspace: workspace.name,
        symbol: specifier,
      });
    }
  };