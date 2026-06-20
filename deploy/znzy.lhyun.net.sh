#!/bin/bash
# znzy.lhyun.net 一键部署（在服务器项目目录执行）
set -euo pipefail

cd "$(dirname "$0")/.."

echo "==> 构建并启动 znzy.lhyun.net 生产栈 (web:80 + api + mysql + redis)"
docker compose -f docker-compose.prod.yml up -d --build

echo ""
echo "部署完成。请确认："
echo "  1. 域名 znzy.lhyun.net 已解析到本机"
echo "  2. 服务器 80 端口可访问（或设置 WEB_PORT 后由外层 Nginx 反代）"
echo ""
echo "测试地址："
echo "  https://znzy.lhyun.net/standalone-test.html"
echo "  https://znzy.lhyun.net/?studentId=stu-test-001&studentName=测试学生"
echo ""
echo "查看日志: docker compose -f docker-compose.prod.yml logs -f web api"
