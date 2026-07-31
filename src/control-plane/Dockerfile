FROM mcr.microsoft.com/dotnet/sdk:10.0-alpine AS build
WORKDIR /source
COPY Arrspire.ControlPlane/Arrspire.ControlPlane.csproj Arrspire.ControlPlane/
COPY Arrspire.ServiceDefaults/Arrspire.ServiceDefaults.csproj Arrspire.ServiceDefaults/
RUN dotnet restore Arrspire.ControlPlane/Arrspire.ControlPlane.csproj
COPY Arrspire.ControlPlane/ Arrspire.ControlPlane/
COPY Arrspire.ServiceDefaults/ Arrspire.ServiceDefaults/
RUN dotnet publish Arrspire.ControlPlane/Arrspire.ControlPlane.csproj \
    --configuration Release \
    --no-restore \
    --output /app

FROM mcr.microsoft.com/dotnet/aspnet:10.0-alpine
RUN apk add --no-cache icu-libs tzdata
ENV DOTNET_SYSTEM_GLOBALIZATION_INVARIANT=false
WORKDIR /app
COPY --from=build /app/ ./
ENTRYPOINT ["dotnet", "/app/Arrspire.ControlPlane.dll"]
