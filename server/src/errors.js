'use strict'

// 类型化错误体系：控制器只抛这些，全局处理器统一转成规范 JSON。
// 客户端永远看不到堆栈与内部细节。

class AppError extends Error {
  constructor(code, message, status = 500, details = null) {
    super(message)
    this.name = this.constructor.name
    this.code = code
    this.status = status
    this.details = details
    this.expose = status < 500
  }
}

class ValidationError extends AppError {
  constructor(message, details) {
    super('VALIDATION_ERROR', message, 400, details)
  }
}

class NotFoundError extends AppError {
  constructor(message = '资源不存在') {
    super('NOT_FOUND', message, 404)
  }
}

class ConflictError extends AppError {
  constructor(message, details) {
    super('CONFLICT', message, 409, details)
  }
}

class UpstreamError extends AppError {
  constructor(message, details) {
    super('UPSTREAM_ERROR', message, 502, details)
  }
}

class RateLimitError extends AppError {
  constructor(message = '请求过于频繁') {
    super('RATE_LIMITED', message, 429)
  }
}

// 内部错误：对外只回「服务异常」，细节只进日志。
class InternalError extends AppError {
  constructor(message = '服务异常，请稍后再试', cause) {
    super('INTERNAL_ERROR', message, 500)
    this.cause = cause
  }
}

module.exports = {
  AppError,
  ValidationError,
  NotFoundError,
  ConflictError,
  UpstreamError,
  RateLimitError,
  InternalError,
}
