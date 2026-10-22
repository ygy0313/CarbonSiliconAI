# 零外部依赖：只要一个支持 C++17 的编译器。
#
#   make            编译
#   make test       自检
#   make bench      压测
#   make run        起服务（8788，仅本机）
#
# 交叉编译到 ECS（x86_64 Linux）：
#   make CXX=x86_64-linux-gnu-g++ EXTRA=-static
CXX      ?= c++
CXXFLAGS ?= -std=c++17 -O2 -Wall -Wextra -pthread -Iinclude
LDFLAGS  ?=
EXTRA    ?=
SRC       = src/kernel.cpp src/server.cpp src/main.cpp
BIN       = bin/qjz-core

all: $(BIN)

$(BIN): $(SRC) include/kernel.hpp include/minijson.hpp Makefile
	@mkdir -p bin
	$(CXX) $(CXXFLAGS) -o $@ $(SRC) $(LDFLAGS) $(EXTRA)

test: $(BIN)
	./$(BIN) selftest

bench: $(BIN)
	./$(BIN) bench

run: $(BIN)
	./$(BIN) serve 8788

clean:
	rm -rf bin

.PHONY: all test bench run clean
