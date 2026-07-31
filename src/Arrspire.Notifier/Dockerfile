FROM mcr.microsoft.com/dotnet/sdk:10.0-alpine AS build
WORKDIR /source
COPY Arrspire.ControlPlane/Arrspire.ControlPlane.csproj Arrspire.ControlPlane/
COPY Arrspire.ServiceDefaults/Arrspire.ServiceDefaults.csproj Arrspire.ServiceDefaults/
COPY Arrspire.Notifier/Arrspire.Notifier.csproj Arrspire.Notifier/
RUN dotnet restore Arrspire.Notifier/Arrspire.Notifier.csproj
COPY Arrspire.ControlPlane/ Arrspire.ControlPlane/
COPY Arrspire.ServiceDefaults/ Arrspire.ServiceDefaults/
COPY Arrspire.Notifier/ Arrspire.Notifier/
RUN dotnet publish Arrspire.Notifier/Arrspire.Notifier.csproj \
    --configuration Release \
    --no-restore \
    --output /app

FROM mcr.microsoft.com/dotnet/aspnet:10.0-alpine
RUN apk add --no-cache curl icu-libs tzdata
ENV DOTNET_SYSTEM_GLOBALIZATION_INVARIANT=false
WORKDIR /app
COPY --from=build /app/ ./
ENTRYPOINT ["dotnet", "/app/Arrspire.Notifier.dll"]
