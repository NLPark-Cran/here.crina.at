#!/usr/bin/env bash
# 镜听空间一键冒烟体检
set -u
BASE="${1:-https://here.crina.at}"
PASS=0; FAIL=0
check() { # name path expect_substr
  local out code
  out=$(curl -s --max-time 15 "$BASE$2"); code=$?
  if [ $code -ne 0 ]; then echo "❌ $1 (curl失败)"; FAIL=$((FAIL+1)); return; fi
  if echo "$out" | grep -q "$3"; then echo "✅ $1"; PASS=$((PASS+1)); else echo "❌ $1 → ${out:0:120}"; FAIL=$((FAIL+1)); fi
}
check "健康检查"        /api/health            '"ok":true'
check "居民名录"        /api/space/characters  '"crina"'
check "在场状态"        /api/space/presence    '"presence"'
check "客厅时间线"      "/api/posts?limit=3"   '"posts"'
check "公开沉淀"        /api/wiki              '"pages"'
check "衣橱与小金库"    /api/space/wardrobe    '"balance"'
check "垃圾堆彩蛋(POST 应405/200)"  /api/space/garbage  '.*'
check "未登录拦截"      /api/letters           '未登录'
# 观猹跳转用下面的 LOC 检查
LOC=$(curl -s -o /dev/null -w "%{redirect_url}" --max-time 10 "$BASE/api/auth/watcha/login")
if echo "$LOC" | grep -q "watcha.cn/oauth/authorize"; then echo "✅ 观猹 OAuth 跳转"; PASS=$((PASS+1)); else echo "❌ 观猹 OAuth 跳转"; FAIL=$((FAIL+1)); fi
echo "—— 通过 $PASS / $((PASS+FAIL)) ——"
[ $FAIL -eq 0 ]
