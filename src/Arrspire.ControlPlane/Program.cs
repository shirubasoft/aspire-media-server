using Arrspire.ControlPlane;

try
{
    var command = args.FirstOrDefault()
        ?? throw new InvalidOperationException(
            "Expected bootstrap, reconcile, serve-notifications, or verify.");
    using var cancellation = new CancellationTokenSource();
    Console.CancelKeyPress += (_, eventArgs) =>
    {
        eventArgs.Cancel = true;
        cancellation.Cancel();
    };

    switch (command)
    {
        case "bootstrap":
            await Bootstrap.RunAsync(cancellation.Token);
            break;
        case "reconcile":
            await Retry.ExecuteAsync(
                Reconciler.RunAsync,
                attempts: 12,
                initialDelay: TimeSpan.FromSeconds(2),
                maximumDelay: TimeSpan.FromSeconds(30),
                cancellation.Token);
            break;
        case "verify":
            await Acceptance.VerifyAsync(cancellation.Token);
            break;
        case "serve-notifications":
            await NotificationRelay.RunAsync(cancellation.Token);
            break;
        default:
            throw new InvalidOperationException(
                $"Expected bootstrap, reconcile, serve-notifications, or verify; received {command}.");
    }
}
catch (OperationCanceledException)
{
    Log.Info("Control plane stopped");
}
catch (Exception exception)
{
    Log.Error("Control plane failed", new
    {
        error = exception.Message,
        stack = exception.StackTrace,
    });
    Environment.ExitCode = 1;
}
