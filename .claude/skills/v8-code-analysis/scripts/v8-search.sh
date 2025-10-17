#!/bin/bash
# V8 code search helper - simplifies common grep patterns

set -e

show_usage() {
  cat << EOF
V8 Code Search Helper

Usage: $0 <command> <search_term> [options]

Commands:
  func <name>       Find function definitions
  class <name>      Find class definitions
  calls <name>      Find function call sites
  var <name>        Find variable declarations
  macro <name>      Find macro definitions
  all <term>        Search everywhere

Examples:
  $0 func FoldBranch
  $0 class MaglevGraphBuilder
  $0 calls GetLatestCheckpointedFrame
  $0 macro DCHECK

Options:
  --include-tests   Include test files (default: excluded)
  --no-color        Disable colored output
EOF
}

# Default settings
INCLUDE_TESTS=false
COLOR_FLAG="--color=auto"

# Parse options
while [[ $# -gt 0 ]]; do
  case $1 in
    --include-tests)
      INCLUDE_TESTS=true
      shift
      ;;
    --no-color)
      COLOR_FLAG="--color=never"
      shift
      ;;
    -h|--help)
      show_usage
      exit 0
      ;;
    *)
      break
      ;;
  esac
done

if [ $# -lt 2 ]; then
  show_usage
  exit 1
fi

COMMAND=$1
SEARCH_TERM=$2

# Build exclusion pattern
EXCLUDE_PATTERN=""
if [ "$INCLUDE_TESTS" = false ]; then
  EXCLUDE_PATTERN=':(exclude)test/'
fi

# Execute search
case "$COMMAND" in
  func)
    echo "=== Function definitions for '$SEARCH_TERM' ==="
    git grep -n $COLOR_FLAG "^\(void\|int\|bool\|.*\) $SEARCH_TERM(" -- "*.cc" "*.h" $EXCLUDE_PATTERN
    ;;
  class)
    echo "=== Class definitions for '$SEARCH_TERM' ==="
    git grep -n $COLOR_FLAG "^class $SEARCH_TERM" -- "*.h" $EXCLUDE_PATTERN
    ;;
  calls)
    echo "=== Call sites for '$SEARCH_TERM' ==="
    git grep -n $COLOR_FLAG "$SEARCH_TERM(" -- "*.cc" $EXCLUDE_PATTERN
    ;;
  var)
    echo "=== Variable declarations for '$SEARCH_TERM' ==="
    git grep -n $COLOR_FLAG "\b$SEARCH_TERM\s*=" -- "*.cc" "*.h" $EXCLUDE_PATTERN
    ;;
  macro)
    echo "=== Macro definitions for '$SEARCH_TERM' ==="
    git grep -n $COLOR_FLAG "^#define $SEARCH_TERM" -- "*.h" $EXCLUDE_PATTERN
    ;;
  all)
    echo "=== All occurrences of '$SEARCH_TERM' ==="
    git grep -n $COLOR_FLAG "$SEARCH_TERM" -- "*.cc" "*.h" $EXCLUDE_PATTERN
    ;;
  *)
    echo "Error: Unknown command '$COMMAND'"
    echo ""
    show_usage
    exit 1
    ;;
esac
