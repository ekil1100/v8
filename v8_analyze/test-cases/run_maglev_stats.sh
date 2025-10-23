#!/bin/bash
# Maglev统计演示运行脚本
# 快速运行各种Maglev统计命令

# 颜色定义
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# V8路径和构建配置
V8_ROOT="/home/like/google/v8/v8"
D8_PATH="${V8_ROOT}/out/x64.release/d8"
TEST_FILE="${V8_ROOT}/v8_analyze/test-cases/maglev-stats-demo.js"
OUTPUT_DIR="${V8_ROOT}/v8_analyze/test-cases/output"

# 创建输出目录
mkdir -p "$OUTPUT_DIR"

# 检查d8是否存在
if [ ! -f "$D8_PATH" ]; then
    echo -e "${RED}错误: d8 未找到于 $D8_PATH${NC}"
    echo "请先构建V8:"
    echo "  tools/dev/gm.py x64.release"
    exit 1
fi

# 检查测试文件是否存在
if [ ! -f "$TEST_FILE" ]; then
    echo -e "${RED}错误: 测试文件未找到: $TEST_FILE${NC}"
    exit 1
fi

# 显示菜单
show_menu() {
    echo -e "${GREEN}========================================${NC}"
    echo -e "${GREEN}  Maglev 统计演示工具${NC}"
    echo -e "${GREEN}========================================${NC}"
    echo ""
    echo "请选择运行模式:"
    echo ""
    echo -e "${BLUE}基础模式:${NC}"
    echo "  1) trace-opt-stats      - 实时追踪每个函数编译 (推荐首次使用)"
    echo "  2) maglev-stats         - 详细的阶段统计"
    echo "  3) maglev-stats-nvp     - JSON格式输出"
    echo ""
    echo -e "${BLUE}高级模式:${NC}"
    echo "  4) 完整追踪             - trace-opt + maglev-stats"
    echo "  5) 包含反优化追踪       - 追踪deopt"
    echo "  6) Runtime Call Stats   - 结合RCS统计"
    echo ""
    echo -e "${BLUE}对比模式:${NC}"
    echo "  7) Maglev vs TurboFan   - 对比两种编译器"
    echo "  8) 优化 vs 未优化       - 对比性能差异"
    echo ""
    echo -e "${BLUE}调试模式:${NC}"
    echo "  9) 追踪图构建           - trace-maglev-graph-building"
    echo " 10) 追踪内联决策         - trace-maglev-inlining"
    echo " 11) 打印生成代码         - print-maglev-code"
    echo ""
    echo -e "${BLUE}其他:${NC}"
    echo "  0) 退出"
    echo ""
    echo -n "请选择 [0-11]: "
}

# 运行命令并保存输出
run_command() {
    local desc="$1"
    local cmd="$2"
    local output_file="$3"

    echo -e "\n${GREEN}=== $desc ===${NC}\n"
    echo -e "${YELLOW}运行命令:${NC}"
    echo "$cmd"
    echo ""

    if [ -n "$output_file" ]; then
        echo -e "${YELLOW}输出将保存到: $output_file${NC}\n"
        eval "$cmd" 2>&1 | tee "$output_file"
        echo -e "\n${GREEN}✓ 完成！输出已保存到: $output_file${NC}"
    else
        eval "$cmd"
        echo -e "\n${GREEN}✓ 完成！${NC}"
    fi

    echo ""
    read -p "按Enter继续..."
}

# 主循环
while true; do
    clear
    show_menu
    read choice

    case $choice in
        1)
            run_command \
                "实时追踪每个函数的编译时间" \
                "$D8_PATH --trace-opt-stats $TEST_FILE" \
                "$OUTPUT_DIR/trace_opt_stats.log"
            ;;
        2)
            run_command \
                "详细的编译阶段统计" \
                "$D8_PATH --maglev-stats $TEST_FILE" \
                "$OUTPUT_DIR/maglev_stats.log"
            ;;
        3)
            run_command \
                "JSON格式统计输出" \
                "$D8_PATH --maglev-stats-nvp $TEST_FILE" \
                "$OUTPUT_DIR/maglev_stats.json"
            ;;
        4)
            run_command \
                "完整的优化和统计追踪" \
                "$D8_PATH --trace-opt --trace-opt-stats --maglev-stats $TEST_FILE" \
                "$OUTPUT_DIR/full_trace.log"
            ;;
        5)
            run_command \
                "包含反优化追踪" \
                "$D8_PATH --trace-opt --trace-deopt --trace-opt-stats $TEST_FILE" \
                "$OUTPUT_DIR/with_deopt.log"
            ;;
        6)
            run_command \
                "Runtime Call Stats + Maglev统计" \
                "$D8_PATH --runtime-call-stats --maglev-stats $TEST_FILE" \
                "$OUTPUT_DIR/rcs_maglev.log"
            ;;
        7)
            echo -e "\n${GREEN}=== Maglev vs TurboFan 对比 ===${NC}\n"

            echo -e "${BLUE}运行 Maglev 编译...${NC}"
            $D8_PATH --trace-opt-stats $TEST_FILE 2>&1 | grep "maglev" | tee "$OUTPUT_DIR/maglev_only.log"

            echo -e "\n${BLUE}运行 TurboFan 编译 (禁用Maglev)...${NC}"
            $D8_PATH --no-maglev --trace-opt-stats $TEST_FILE 2>&1 | grep "turbofan" | tee "$OUTPUT_DIR/turbofan_only.log"

            echo -e "\n${GREEN}对比结果:${NC}"
            echo "Maglev 编译统计:"
            cat "$OUTPUT_DIR/maglev_only.log"
            echo ""
            echo "TurboFan 编译统计:"
            cat "$OUTPUT_DIR/turbofan_only.log"

            echo -e "\n${GREEN}✓ 完成！结果已保存到 output/ 目录${NC}"
            read -p "按Enter继续..."
            ;;
        8)
            echo -e "\n${GREEN}=== 优化 vs 未优化 性能对比 ===${NC}\n"

            echo -e "${BLUE}运行未优化版本...${NC}"
            /usr/bin/time -v $D8_PATH --no-opt $TEST_FILE 2>&1 | grep -E "(User time|Maximum)" | tee "$OUTPUT_DIR/no_opt_perf.log"

            echo -e "\n${BLUE}运行优化版本 (Maglev)...${NC}"
            /usr/bin/time -v $D8_PATH $TEST_FILE 2>&1 | grep -E "(User time|Maximum)" | tee "$OUTPUT_DIR/opt_perf.log"

            echo -e "\n${GREEN}✓ 完成！${NC}"
            read -p "按Enter继续..."
            ;;
        9)
            run_command \
                "追踪Maglev图构建过程" \
                "$D8_PATH --trace-maglev-graph-building $TEST_FILE" \
                "$OUTPUT_DIR/graph_building.log"
            ;;
        10)
            run_command \
                "追踪Maglev内联决策" \
                "$D8_PATH --trace-maglev-inlining $TEST_FILE" \
                "$OUTPUT_DIR/inlining.log"
            ;;
        11)
            run_command \
                "打印Maglev生成的代码" \
                "$D8_PATH --print-maglev-code $TEST_FILE" \
                "$OUTPUT_DIR/maglev_code.asm"
            ;;
        0)
            echo -e "\n${GREEN}再见！${NC}\n"
            exit 0
            ;;
        *)
            echo -e "\n${RED}无效选择，请重试${NC}"
            sleep 2
            ;;
    esac
done
