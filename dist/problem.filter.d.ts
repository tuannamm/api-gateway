import { type ArgumentsHost, type ExceptionFilter } from '@nestjs/common';
export declare class ProblemExceptionFilter implements ExceptionFilter {
    private readonly logger;
    catch(exception: unknown, host: ArgumentsHost): void;
    private toGatewayError;
}
